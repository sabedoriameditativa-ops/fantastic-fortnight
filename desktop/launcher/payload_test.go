package main

import (
	"context"
	"crypto/sha256"
	"debug/pe"
	"encoding/hex"
	"io"
	"os"
	"path/filepath"
	"testing"
)

// FE_LAUNCHER_TEST_PAYLOAD points to the exact ZIP produced by the Windows
// builder. This exercises real runtime extraction on the build host without
// pretending that cross-compilation executes the Windows UI.
func TestRealDistributionPayload(t *testing.T) {
	filename := os.Getenv("FE_LAUNCHER_TEST_PAYLOAD")
	if filename == "" {
		t.Skip("set FE_LAUNCHER_TEST_PAYLOAD to validate the distribution archive")
	}
	payload, err := os.ReadFile(filename)
	if err != nil {
		t.Fatal(err)
	}
	entries, err := inspectArchive(payload)
	if err != nil {
		t.Fatal(err)
	}
	var expectedNodeHash string
	for _, entry := range entries {
		if entry.name == "node.exe" {
			reader, err := entry.file.Open()
			if err != nil {
				t.Fatal(err)
			}
			hash := sha256.New()
			_, err = io.Copy(hash, reader)
			reader.Close()
			if err != nil {
				t.Fatal(err)
			}
			expectedNodeHash = hex.EncodeToString(hash.Sum(nil))
		}
	}
	cache := filepath.Join(t.TempDir(), "Usuário com espaços", "runtime")
	dest, err := installPayload(context.Background(), cache, payload)
	if err != nil {
		t.Fatal(err)
	}
	node, err := pe.Open(filepath.Join(dest, "node.exe"))
	if err != nil {
		t.Fatal(err)
	}
	if node.Machine != pe.IMAGE_FILE_MACHINE_AMD64 {
		t.Fatal("runtime is not Windows x64")
	}
	node.Close()
	file, err := os.Open(filepath.Join(dest, "node.exe"))
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.New()
	_, err = io.Copy(hash, file)
	file.Close()
	if err != nil || hex.EncodeToString(hash.Sum(nil)) != expectedNodeHash {
		t.Fatalf("extracted Node hash differs from payload: %v", err)
	}
	for _, name := range []string{
		"app/client/index.html", "app/client/battle/simWorker.js",
		"app/shared/sim/battle.js", "app/server/profileVerifier.js",
		"app/node_modules/ws/package.json", "LICENSES/Node.txt",
		"LICENSES/Go.txt", "LICENSES/ws.txt", "LEIA-ME.txt",
	} {
		info, err := os.Stat(filepath.Join(dest, filepath.FromSlash(name)))
		if err != nil || !info.Mode().IsRegular() || info.Size() == 0 {
			t.Fatalf("missing distribution asset %s: %v", name, err)
		}
	}
	before, _ := os.Stat(filepath.Join(dest, "node.exe"))
	again, err := installPayload(context.Background(), cache, payload)
	after, _ := os.Stat(filepath.Join(dest, "node.exe"))
	if err != nil || again != dest || !before.ModTime().Equal(after.ModTime()) {
		t.Fatalf("real runtime cache was not reused: %v", err)
	}
	entry := filepath.Join(dest, "app", "server", "desktop.js")
	original, err := os.ReadFile(entry)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(entry, []byte("interrupted update"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := installPayload(context.Background(), cache, payload); err != nil {
		t.Fatal(err)
	}
	repaired, err := os.ReadFile(entry)
	if err != nil || string(repaired) != string(original) {
		t.Fatalf("real runtime cache repair failed: %v", err)
	}
	t.Logf("runtime verified: %d files, node.exe SHA256 %s", len(entries), expectedNodeHash)
}
