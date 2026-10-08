package main

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"hash/crc32"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
)

const (
	maxArchiveFiles  = 20000
	maxArchiveBytes  = uint64(512 << 20)
	maxFileBytes     = uint64(256 << 20)
	completionMarker = ".payload.sha256"
)

type archiveEntry struct {
	file      *zip.File
	name      string
	directory bool
}

// ZIP names are validated using Windows semantics even during Linux builds.
// Disallow aliases (trailing dots/spaces, ADS, DOS devices, mixed separators)
// rather than relying on the host's filepath.Clean behavior.
func safeArchiveName(raw string) (string, error) {
	name := strings.TrimSuffix(raw, "/")
	if name == "" || strings.HasPrefix(name, "/") || strings.Contains(raw, "\\") || path.Clean(name) != name {
		return "", fmt.Errorf("caminho inválido no pacote: %q", raw)
	}
	for _, component := range strings.Split(name, "/") {
		if component == "" || component == "." || component == ".." || strings.HasSuffix(component, ".") || strings.HasSuffix(component, " ") {
			return "", fmt.Errorf("caminho inválido no pacote: %q", raw)
		}
		for _, r := range component {
			if r < 32 || strings.ContainsRune(`<>:"|?*`, r) {
				return "", fmt.Errorf("caractere inválido no pacote: %q", raw)
			}
		}
		base := strings.ToUpper(strings.SplitN(component, ".", 2)[0])
		if base == "CON" || base == "PRN" || base == "AUX" || base == "NUL" || base == "CONIN$" || base == "CONOUT$" {
			return "", fmt.Errorf("nome reservado no pacote: %q", raw)
		}
		for _, prefix := range []string{"COM", "LPT"} {
			if strings.HasPrefix(base, prefix) && strings.Contains("123456789¹²³", strings.TrimPrefix(base, prefix)) && len([]rune(strings.TrimPrefix(base, prefix))) == 1 {
				return "", fmt.Errorf("nome reservado no pacote: %q", raw)
			}
		}
	}
	if strings.EqualFold(name, completionMarker) {
		return "", errors.New("o pacote usa um nome interno reservado")
	}
	return name, nil
}

func inspectArchive(payload []byte) ([]archiveEntry, error) {
	r, err := zip.NewReader(bytes.NewReader(payload), int64(len(payload)))
	if err != nil {
		return nil, fmt.Errorf("pacote do jogo inválido: %w", err)
	}
	if len(r.File) == 0 || len(r.File) > maxArchiveFiles {
		return nil, errors.New("quantidade de arquivos inválida no pacote")
	}
	entries := make([]archiveEntry, 0, len(r.File))
	type node struct {
		name                string
		directory, explicit bool
	}
	paths := make(map[string]node)
	var total uint64
	for _, file := range r.File {
		name, err := safeArchiveName(file.Name)
		if err != nil {
			return nil, err
		}
		mode := file.Mode()
		directory := file.FileInfo().IsDir()
		if mode&os.ModeType != 0 && !mode.IsDir() {
			return nil, fmt.Errorf("links e arquivos especiais não são permitidos: %s", name)
		}
		if file.UncompressedSize64 > maxFileBytes || file.UncompressedSize64 > maxArchiveBytes-total {
			return nil, errors.New("o pacote excede o limite de tamanho")
		}
		total += file.UncompressedSize64
		if directory && file.UncompressedSize64 != 0 {
			return nil, fmt.Errorf("diretório com conteúdo inválido: %s", name)
		}
		parts := strings.Split(name, "/")
		for i := range parts {
			prefix := strings.Join(parts[:i+1], "/")
			key := strings.ToLower(prefix)
			isDir := i < len(parts)-1 || directory
			old, exists := paths[key]
			explicit := i == len(parts)-1
			if exists && (old.name != prefix || old.directory != isDir || (explicit && old.explicit)) {
				return nil, fmt.Errorf("caminhos conflitantes no pacote: %s", name)
			}
			paths[key] = node{prefix, isDir, explicit || old.explicit}
		}
		entries = append(entries, archiveEntry{file, name, directory})
	}
	for _, required := range []string{"node.exe", "app/server/desktop.js", "app/package.json"} {
		item, exists := paths[required]
		if !exists || item.directory || item.name != required {
			return nil, fmt.Errorf("arquivo obrigatório ausente: %s", required)
		}
	}
	return entries, nil
}

func plainDirectory(name string) bool {
	st, err := os.Lstat(name)
	return err == nil && st.IsDir() && st.Mode()&os.ModeSymlink == 0
}

// Existing files are checked against the embedded ZIP, not only a completion
// marker. This detects incomplete/corrupt caches without reinstalling each run.
func validCache(ctx context.Context, dir, digest string, entries []archiveEntry) bool {
	if !plainDirectory(dir) {
		return false
	}
	marker := filepath.Join(dir, completionMarker)
	st, err := os.Lstat(marker)
	if err != nil || !st.Mode().IsRegular() {
		return false
	}
	content, err := os.ReadFile(marker)
	if err != nil || string(content) != digest {
		return false
	}
	for _, entry := range entries {
		if ctx.Err() != nil {
			return false
		}
		current := dir
		parts := strings.Split(entry.name, "/")
		for i, part := range parts {
			current = filepath.Join(current, part)
			st, err = os.Lstat(current)
			if err != nil || st.Mode()&os.ModeSymlink != 0 {
				return false
			}
			if i < len(parts)-1 || entry.directory {
				if !st.IsDir() {
					return false
				}
			} else if !st.Mode().IsRegular() || uint64(st.Size()) != entry.file.UncompressedSize64 {
				return false
			}
		}
		if entry.directory {
			continue
		}
		f, err := os.Open(current)
		if err != nil {
			return false
		}
		h := crc32.NewIEEE()
		n, copyErr := io.Copy(h, io.LimitReader(f, int64(maxFileBytes)+1))
		closeErr := f.Close()
		if copyErr != nil || closeErr != nil || uint64(n) != entry.file.UncompressedSize64 || h.Sum32() != entry.file.CRC32 {
			return false
		}
	}
	return true
}

func extractEntries(ctx context.Context, dir string, entries []archiveEntry) error {
	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			return err
		}
		target := filepath.Join(dir, filepath.FromSlash(entry.name))
		if entry.directory {
			if err := os.MkdirAll(target, 0700); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0700); err != nil {
			return err
		}
		src, err := entry.file.Open()
		if err != nil {
			return err
		}
		dst, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			src.Close()
			return err
		}
		n, copyErr := io.Copy(dst, io.LimitReader(src, int64(maxFileBytes)+1))
		srcErr, dstErr := src.Close(), dst.Close()
		if copyErr != nil {
			return copyErr
		}
		if srcErr != nil {
			return srcErr
		}
		if dstErr != nil {
			return dstErr
		}
		if n < 0 || uint64(n) != entry.file.UncompressedSize64 || uint64(n) > maxFileBytes {
			return errors.New("tamanho inesperado ao extrair o pacote")
		}
	}
	return nil
}

// installPayload atomically publishes one immutable runtime per payload hash.
// An invalid earlier cache is preserved under a backup name; profile data is
// outside cacheRoot and is never removed or replaced by this function.
func installPayload(ctx context.Context, cacheRoot string, payload []byte) (string, error) {
	entries, err := inspectArchive(payload)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(payload)
	digest := hex.EncodeToString(sum[:])
	if err := os.MkdirAll(cacheRoot, 0700); err != nil {
		return "", err
	}
	if !plainDirectory(cacheRoot) {
		return "", errors.New("a pasta de execução não pode ser um link")
	}
	dest := filepath.Join(cacheRoot, digest[:32])
	if validCache(ctx, dest, digest, entries) {
		return dest, nil
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	temp, err := os.MkdirTemp(cacheRoot, ".extraindo-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(temp)
	if err := extractEntries(ctx, temp, entries); err != nil {
		return "", fmt.Errorf("não foi possível extrair o jogo: %w", err)
	}
	if err := os.WriteFile(filepath.Join(temp, completionMarker), []byte(digest), 0600); err != nil {
		return "", err
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if _, err := os.Lstat(dest); err == nil {
		// Another installer may have completed while we extracted.
		if validCache(ctx, dest, digest, entries) {
			return dest, nil
		}
		backup, err := os.MkdirTemp(cacheRoot, ".cache-anterior-")
		if err != nil {
			return "", err
		}
		if err := os.Remove(backup); err != nil {
			return "", err
		}
		if err := os.Rename(dest, backup); err != nil {
			return "", fmt.Errorf("não foi possível preservar a execução anterior: %w", err)
		}
	} else if !os.IsNotExist(err) {
		return "", err
	}
	if err := os.Rename(temp, dest); err != nil {
		return "", fmt.Errorf("não foi possível concluir a instalação: %w", err)
	}
	return dest, nil
}
