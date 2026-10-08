package main

import (
	"archive/zip"
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type fixtureFile struct {
	name, content string
	mode          os.FileMode
}

func fixturePayload(t *testing.T, extra ...fixtureFile) []byte {
	t.Helper()
	files := []fixtureFile{{"node.exe", "runtime", 0600}, {"app/package.json", `{"type":"module"}`, 0600}, {"app/server/desktop.js", "console.log('ready')", 0600}}
	files = append(files, extra...)
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	for _, file := range files {
		h := &zip.FileHeader{Name: file.name, Method: zip.Deflate}
		h.SetMode(file.mode)
		dest, err := w.CreateHeader(h)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := dest.Write([]byte(file.content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestInstallReusesCacheAndKeepsProfilesAcrossVersions(t *testing.T) {
	base := filepath.Join(t.TempDir(), "Usuário com espaço", "Frota Estelar")
	data := filepath.Join(base, "data")
	if err := os.MkdirAll(data, 0700); err != nil {
		t.Fatal(err)
	}
	profile := filepath.Join(data, "profiles.sqlite")
	if err := os.WriteFile(profile, []byte("progresso existente"), 0600); err != nil {
		t.Fatal(err)
	}
	cache := filepath.Join(base, "runtime")
	payload := fixturePayload(t, fixtureFile{"app/textos/ação.txt", "Olá, comandante", 0600})
	first, err := installPayload(context.Background(), cache, payload)
	if err != nil {
		t.Fatal(err)
	}
	before, err := os.Stat(filepath.Join(first, "node.exe"))
	if err != nil {
		t.Fatal(err)
	}
	again, err := installPayload(context.Background(), cache, payload)
	if err != nil || first != again {
		t.Fatalf("cache não reutilizado: %s %v", again, err)
	}
	after, _ := os.Stat(filepath.Join(first, "node.exe"))
	if before.ModTime() != after.ModTime() {
		t.Fatal("cache válido foi reescrito")
	}
	text, _ := os.ReadFile(filepath.Join(first, "app", "textos", "ação.txt"))
	if string(text) != "Olá, comandante" {
		t.Fatal("arquivo Unicode não preservado")
	}
	second, err := installPayload(context.Background(), cache, fixturePayload(t, fixtureFile{"app/new.txt", "nova versão", 0600}))
	if err != nil || first == second {
		t.Fatalf("versão não isolada: %s %v", second, err)
	}
	if _, err := os.Stat(first); err != nil {
		t.Fatal("versão anterior removida")
	}
	value, _ := os.ReadFile(profile)
	if string(value) != "progresso existente" {
		t.Fatal("dados do perfil foram alterados")
	}
}

func TestArchiveRejectsWindowsTraversalAndAliases(t *testing.T) {
	for _, name := range []string{"../escape", "app/../../escape", "/absolute", `C:\escape`, `app\..\escape`, "app/./entry", "app//entry", "app/file.", "app/file ", "app/file:stream", "app/CON.txt", "app/com1", "app/LPT².log", "app/CONOUT$", "app/bad\x00name", completionMarker} {
		t.Run(strings.ReplaceAll(name, "/", "_"), func(t *testing.T) {
			if _, err := inspectArchive(fixturePayload(t, fixtureFile{name, "bad", 0600})); err == nil {
				t.Fatalf("nome inseguro aceito: %q", name)
			}
		})
	}
}

func TestArchiveRejectsLinksAndConflictingPaths(t *testing.T) {
	cases := [][]fixtureFile{
		{{"app/link", "../../outside", os.ModeSymlink | 0777}},
		{{"APP/other.js", "x", 0600}},
		{{"app/server", "not a directory", 0600}},
		{{"node.exe", "duplicate", 0600}},
		{{"app/pipe", "x", os.ModeNamedPipe | 0600}},
	}
	for _, extra := range cases {
		if _, err := inspectArchive(fixturePayload(t, extra...)); err == nil {
			t.Fatalf("conflito aceito: %+v", extra)
		}
	}
}

func TestArchiveChecksSizeBeforeExtracting(t *testing.T) {
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	h := &zip.FileHeader{Name: "node.exe", Method: zip.Store, UncompressedSize64: maxFileBytes + 1}
	if _, err := w.CreateRaw(h); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := inspectArchive(buf.Bytes()); err == nil {
		t.Fatal("arquivo excessivo aceito")
	}
	if _, err := inspectArchive([]byte("not a zip")); err == nil {
		t.Fatal("arquivo não ZIP aceito")
	}
	var empty bytes.Buffer
	z := zip.NewWriter(&empty)
	z.Close()
	if _, err := inspectArchive(empty.Bytes()); err == nil {
		t.Fatal("ZIP vazio aceito")
	}
}

func TestPartialOrCorruptExtractionIsNeverPublished(t *testing.T) {
	payload := fixturePayload(t)
	index := bytes.Index(payload, []byte{'P', 'K', 1, 2})
	if index < 0 {
		t.Fatal("central directory not found")
	}
	payload[index+16] ^= 0xff // corrupt expected CRC, retaining a parseable ZIP
	cache := filepath.Join(t.TempDir(), "runtime")
	if _, err := installPayload(context.Background(), cache, payload); err == nil {
		t.Fatal("pacote corrompido aceito")
	}
	entries, err := os.ReadDir(cache)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("extração incompleta publicada: %v", entries)
	}
}

func TestCorruptCacheIsRebuiltAndPreserved(t *testing.T) {
	cache := filepath.Join(t.TempDir(), "runtime")
	payload := fixturePayload(t)
	dest, err := installPayload(context.Background(), cache, payload)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dest, "node.exe"), []byte("corrupt"), 0600); err != nil {
		t.Fatal(err)
	} // same length, different CRC
	again, err := installPayload(context.Background(), cache, payload)
	if err != nil || again != dest {
		t.Fatalf("reparo falhou: %v", err)
	}
	value, _ := os.ReadFile(filepath.Join(dest, "node.exe"))
	if string(value) != "runtime" {
		t.Fatal("cache não reparado")
	}
	backups, _ := filepath.Glob(filepath.Join(cache, ".cache-anterior-*", "node.exe"))
	if len(backups) != 1 {
		t.Fatal("cache anterior não preservado")
	}
	old, _ := os.ReadFile(backups[0])
	if string(old) != "corrupt" {
		t.Fatal("backup alterado")
	}
}

func TestCacheSymlinkCannotRedirectExtraction(t *testing.T) {
	cache := filepath.Join(t.TempDir(), "runtime")
	payload := fixturePayload(t)
	dest, err := installPayload(context.Background(), cache, payload)
	if err != nil {
		t.Fatal(err)
	}
	outside := t.TempDir()
	marker := filepath.Join(outside, "desktop.js")
	os.WriteFile(marker, []byte("do not touch"), 0600)
	os.RemoveAll(filepath.Join(dest, "app", "server"))
	if err := os.Symlink(outside, filepath.Join(dest, "app", "server")); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	if _, err := installPayload(context.Background(), cache, payload); err != nil {
		t.Fatal(err)
	}
	value, _ := os.ReadFile(marker)
	if string(value) != "do not touch" {
		t.Fatal("escreveu fora do cache")
	}
}

func TestCancelledInstallationPublishesNothing(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	cache := filepath.Join(t.TempDir(), "runtime")
	if _, err := installPayload(ctx, cache, fixturePayload(t)); err != context.Canceled {
		t.Fatalf("cancelamento ignorado: %v", err)
	}
	entries, _ := os.ReadDir(cache)
	if len(entries) != 0 {
		t.Fatal("instalação cancelada publicada")
	}
}
