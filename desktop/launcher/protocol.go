package main

import (
	"encoding/json"
	"errors"
	"strings"
)

type serverMessage struct {
	Type    string `json:"type"`
	URL     string `json:"url"`
	Message string `json:"message"`
}

func parseServerMessage(line []byte) (serverMessage, error) {
	var message serverMessage
	if err := json.Unmarshal(line, &message); err != nil {
		return message, err
	}
	switch message.Type {
	case "ready":
		// Only this stable local origin may be passed to ShellExecuteW. No
		// credentials, alternate protocols, query strings or shell arguments.
		if message.URL != "http://localhost:3000" && message.URL != "http://localhost:3000/" {
			return message, errors.New("o servidor informou um endereço inesperado")
		}
	case "error":
		message.Message = strings.TrimSpace(message.Message)
		if message.Message == "" {
			message.Message = "O servidor não conseguiu iniciar."
		}
		if runes := []rune(message.Message); len(runes) > 2000 {
			message.Message = string(runes[:2000]) + "…"
		}
	default:
		return message, errors.New("resposta desconhecida do servidor")
	}
	return message, nil
}

func nodeEnvironment(inherited []string, dataDir string) []string {
	blocked := map[string]bool{
		"NODE_OPTIONS": true, "NODE_PATH": true, "FE_OPEN_BROWSER": true,
		"FE_DESKTOP_DATA_DIR": true, "FE_DESKTOP_PORT": true,
	}
	out := make([]string, 0, len(inherited)+2)
	for _, value := range inherited {
		name, _, _ := strings.Cut(value, "=")
		if !blocked[strings.ToUpper(name)] {
			out = append(out, value)
		}
	}
	return append(out, "FE_DESKTOP_DATA_DIR="+dataDir, "FE_DESKTOP_PORT=3000")
}
