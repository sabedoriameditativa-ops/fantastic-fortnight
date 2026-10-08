package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestReadyOnlyOpensTheStableLocalGameOrigin(t *testing.T) {
	for _, target := range []string{"http://localhost:3000", "http://localhost:3000/"} {
		line, _ := json.Marshal(serverMessage{Type: "ready", URL: target})
		if _, err := parseServerMessage(line); err != nil {
			t.Fatal(err)
		}
	}
	for _, target := range []string{"https://attacker.example", "file:///C:/Windows/system32/cmd.exe", "http://localhost:3000@evil.example", "http://localhost:3001", "http://localhost:3000/?token=x", "http://localhost:3000/#x", "cmd /c whoami", "http://127.0.0.1:3000"} {
		line, _ := json.Marshal(serverMessage{Type: "ready", URL: target})
		if _, err := parseServerMessage(line); err == nil {
			t.Fatalf("URL insegura aceita: %s", target)
		}
	}
	if _, err := parseServerMessage([]byte(`{"type":"other"}`)); err == nil {
		t.Fatal("tipo inesperado aceito")
	}
}

func TestServerErrorsRemainReadableAndBounded(t *testing.T) {
	line, _ := json.Marshal(serverMessage{Type: "error", Message: strings.Repeat("á", 2500)})
	message, err := parseServerMessage(line)
	if err != nil || len([]rune(message.Message)) != 2001 {
		t.Fatalf("limite Unicode incorreto: %v", err)
	}
	message, err = parseServerMessage([]byte(`{"type":"error"}`))
	if err != nil || message.Message == "" {
		t.Fatal("erro sem explicação")
	}
}

func TestNodeEnvironmentPinsDataAndPortWithoutInheritedNodeInjection(t *testing.T) {
	values := nodeEnvironment([]string{"Path=C:\\Windows", "NODE_OPTIONS=--require attacker.js", "node_path=unsafe", "FE_DESKTOP_PORT=9999", "FE_DESKTOP_DATA_DIR=wrong", "FE_OPEN_BROWSER=1", "LANG=pt_BR"}, `C:\Usuário com espaço\FrotaEstelar\data`)
	joined := strings.Join(values, "\n")
	for _, bad := range []string{"attacker", "unsafe", "9999", "wrong", "FE_OPEN_BROWSER"} {
		if strings.Contains(joined, bad) {
			t.Fatalf("ambiente herdado indevido: %s", bad)
		}
	}
	if !strings.Contains(joined, "FE_DESKTOP_PORT=3000") || !strings.Contains(joined, `FE_DESKTOP_DATA_DIR=C:\Usuário com espaço\FrotaEstelar\data`) || !strings.Contains(joined, "LANG=pt_BR") {
		t.Fatal(joined)
	}
}
