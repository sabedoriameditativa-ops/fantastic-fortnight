//go:build windows

package main

import (
	"fmt"
	"syscall"
	"time"
	"unsafe"
)

var (
	kernel32     = syscall.NewLazyDLL("kernel32.dll")
	createMutexW = kernel32.NewProc("CreateMutexW")
	closeHandle  = kernel32.NewProc("CloseHandle")
	findWindowW  = syscall.NewLazyDLL("user32.dll").NewProc("FindWindowW")
	postMessageW = syscall.NewLazyDLL("user32.dll").NewProc("PostMessageW")
	messageBoxW  = syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW")
)

func utf16(text string) *uint16 {
	p, _ := syscall.UTF16PtrFromString(text)
	return p
}

func fatalDialog(message string) {
	messageBoxW.Call(0, uintptr(unsafe.Pointer(utf16(message))), uintptr(unsafe.Pointer(utf16("Frota Estelar"))), 0x10)
}

func activateExisting() {
	class := utf16(launcherWindowClass)
	// The first process may still be registering its window. Never launch a
	// second Node process while the mutex is owned by that instance.
	for i := 0; i < 60; i++ {
		window, _, _ := findWindowW.Call(uintptr(unsafe.Pointer(class)), 0)
		if window != 0 {
			postMessageW.Call(window, wmReopenLauncher, 0, 0)
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	fatalDialog("O Frota Estelar já está iniciando ou encerrando. Aguarde alguns segundos e tente abrir novamente.")
}

func main() {
	name := utf16(`Local\FrotaEstelarLauncher.v1`)
	mutex, _, err := createMutexW.Call(0, 0, uintptr(unsafe.Pointer(name)))
	if mutex == 0 {
		fatalDialog(fmt.Sprintf("Não foi possível iniciar o Frota Estelar: %v", err))
		return
	}
	defer closeHandle.Call(mutex)
	if err == syscall.Errno(183) {
		activateExisting()
		return
	}
	if err := runUI(startDesktop, nil); err != nil {
		fatalDialog("Não foi possível abrir a janela do jogo:\n" + err.Error())
	}
}
