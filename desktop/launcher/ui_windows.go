//go:build windows

package main

import (
	"fmt"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"unsafe"
)

const (
	launcherWindowClass = "FrotaEstelarLauncher"
	wmReopenLauncher    = 0x8000 + 42
	wmLauncherUpdate    = 0x8000 + 43
	wmLauncherStopped   = 0x8000 + 44
	wmBrowserFailed     = 0x8000 + 45
	launcherOpenID      = 100
	launcherStopID      = 101
	launcherStopTimer   = 1
	launcherWindowStyle = 0x00CF0000 // WS_OVERLAPPEDWINDOW
)

// Empty fields leave the current status or URL unchanged. Providing the first
// GameURL enables the open button and opens the default browser exactly once.
type uiUpdate struct {
	Status  string
	GameURL string
	Failed  bool
}

var (
	uiUser32                 = syscall.NewLazyDLL("user32.dll")
	uiKernel32               = syscall.NewLazyDLL("kernel32.dll")
	uiGDI32                  = syscall.NewLazyDLL("gdi32.dll")
	uiShell32                = syscall.NewLazyDLL("shell32.dll")
	uiOle32                  = syscall.NewLazyDLL("ole32.dll")
	uiRegisterClass          = uiUser32.NewProc("RegisterClassExW")
	uiUnregisterClass        = uiUser32.NewProc("UnregisterClassW")
	uiCreateWindow           = uiUser32.NewProc("CreateWindowExW")
	uiDefWindowProc          = uiUser32.NewProc("DefWindowProcW")
	uiDestroyWindow          = uiUser32.NewProc("DestroyWindow")
	uiGetMessage             = uiUser32.NewProc("GetMessageW")
	uiTranslateMessage       = uiUser32.NewProc("TranslateMessage")
	uiDispatchMessage        = uiUser32.NewProc("DispatchMessageW")
	uiIsDialogMessage        = uiUser32.NewProc("IsDialogMessageW")
	uiPostMessage            = uiUser32.NewProc("PostMessageW")
	uiPostQuitMessage        = uiUser32.NewProc("PostQuitMessage")
	uiShowWindow             = uiUser32.NewProc("ShowWindow")
	uiIsIconic               = uiUser32.NewProc("IsIconic")
	uiSetForegroundWindow    = uiUser32.NewProc("SetForegroundWindow")
	uiSetWindowText          = uiUser32.NewProc("SetWindowTextW")
	uiEnableWindow           = uiUser32.NewProc("EnableWindow")
	uiSetFocus               = uiUser32.NewProc("SetFocus")
	uiSendMessage            = uiUser32.NewProc("SendMessageW")
	uiGetClientRect          = uiUser32.NewProc("GetClientRect")
	uiMoveWindow             = uiUser32.NewProc("MoveWindow")
	uiSetWindowPos           = uiUser32.NewProc("SetWindowPos")
	uiAdjustWindowRect       = uiUser32.NewProc("AdjustWindowRectEx")
	uiAdjustWindowRectForDPI = uiUser32.NewProc("AdjustWindowRectExForDpi")
	uiSetTimer               = uiUser32.NewProc("SetTimer")
	uiKillTimer              = uiUser32.NewProc("KillTimer")
	uiLoadCursor             = uiUser32.NewProc("LoadCursorW")
	uiLoadIcon               = uiUser32.NewProc("LoadIconW")
	uiSetDPIAwarenessContext = uiUser32.NewProc("SetProcessDpiAwarenessContext")
	uiSetProcessDPIAware     = uiUser32.NewProc("SetProcessDPIAware")
	uiGetDPIForWindow        = uiUser32.NewProc("GetDpiForWindow")
	uiGetDC                  = uiUser32.NewProc("GetDC")
	uiReleaseDC              = uiUser32.NewProc("ReleaseDC")
	uiGetModuleHandle        = uiKernel32.NewProc("GetModuleHandleW")
	uiCopyMemory             = uiKernel32.NewProc("RtlMoveMemory")
	uiGetDeviceCaps          = uiGDI32.NewProc("GetDeviceCaps")
	uiCreateFont             = uiGDI32.NewProc("CreateFontW")
	uiDeleteObject           = uiGDI32.NewProc("DeleteObject")
	uiShellExecute           = uiShell32.NewProc("ShellExecuteW")
	uiCoInitialize           = uiOle32.NewProc("CoInitializeEx")
	uiCoUninitialize         = uiOle32.NewProc("CoUninitialize")
	uiWindowCallback         = syscall.NewCallback(launcherWindowProc)
	activeLauncherUI         *launcherUI
)

type uiPoint struct{ X, Y int32 }
type uiRect struct{ Left, Top, Right, Bottom int32 }

type uiMessage struct {
	Window  uintptr
	Message uint32
	WParam  uintptr
	LParam  uintptr
	Time    uint32
	Point   uiPoint
	Private uint32
}

type uiWindowClass struct {
	Size       uint32
	Style      uint32
	WindowProc uintptr
	ClassExtra int32
	WndExtra   int32
	Instance   uintptr
	Icon       uintptr
	Cursor     uintptr
	Background uintptr
	MenuName   *uint16
	ClassName  *uint16
	SmallIcon  uintptr
}

type uiMinMaxInfo struct {
	Reserved, MaxSize, MaxPosition, MinTrackSize, MaxTrackSize uiPoint
}

// Window handles and all fields other than the mutex-protected pending update
// are owned by the message-loop thread. Background work only posts messages.
type launcherUI struct {
	window, title, status, note, openButton, stopButton uintptr
	font, titleFont                                     uintptr
	dpi                                                 int
	gameURL                                             string
	openedBrowser, closing                              bool
	stopReady                                           chan func()
	done                                                chan struct{}
	mu                                                  sync.Mutex
	pending                                             uiUpdate
	failedBrowserURL                                    string
	hasPending, closed                                  bool
}

// start must return a cancellation/cleanup function promptly; preparation and
// the server run in its own goroutine. The UI calls cleanup at most once.
func runUI(start func(notify func(uiUpdate)) func(), reopen <-chan struct{}) error {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	setLauncherDPIAwareness()

	u := &launcherUI{dpi: launcherScreenDPI(), stopReady: make(chan func(), 1), done: make(chan struct{})}
	var instance uintptr
	var registered bool
	className := launcherUTF16(launcherWindowClass)
	activeLauncherUI = u
	defer func() {
		u.mu.Lock()
		u.closed = true
		u.mu.Unlock()
		close(u.done)
		if u.window != 0 {
			uiDestroyWindow.Call(u.window)
		}
		if registered {
			uiUnregisterClass.Call(uintptr(unsafe.Pointer(className)), instance)
		}
		uiDeleteObject.Call(u.font)
		uiDeleteObject.Call(u.titleFont)
		activeLauncherUI = nil
	}()

	instance, _, err := uiGetModuleHandle.Call(0)
	if instance == 0 {
		return launcherWinError("Obter módulo da janela", err)
	}
	cursor, _, _ := uiLoadCursor.Call(0, 32512) // IDC_ARROW
	icon, _, _ := uiLoadIcon.Call(instance, 1)
	if icon == 0 {
		icon, _, _ = uiLoadIcon.Call(0, 32512) // IDI_APPLICATION
	}
	wc := uiWindowClass{WindowProc: uiWindowCallback, Instance: instance, Icon: icon, SmallIcon: icon,
		Cursor: cursor, Background: 16, ClassName: className} // COLOR_BTNFACE + 1
	wc.Size = uint32(unsafe.Sizeof(wc))
	atom, _, err := uiRegisterClass.Call(uintptr(unsafe.Pointer(&wc)))
	if atom == 0 {
		return launcherWinError("Registrar janela", err)
	}
	registered = true
	width, height := u.windowSize(580, 330)
	window, _, err := uiCreateWindow.Call(0x00010000, uintptr(unsafe.Pointer(className)),
		uintptr(unsafe.Pointer(launcherUTF16("Frota Estelar"))), launcherWindowStyle,
		0x80000000, 0x80000000, uintptr(width), uintptr(height), 0, 0, instance, 0)
	if window == 0 {
		return launcherWinError("Criar janela", err)
	}
	u.window = window
	if uiGetDPIForWindow.Find() == nil {
		if dpi, _, _ := uiGetDPIForWindow.Call(window); dpi > 0 {
			u.dpi = int(dpi)
		}
	}
	if err := u.createControls(instance); err != nil {
		return err
	}
	u.setFonts()
	u.layout()
	uiEnableWindow.Call(u.openButton, 0)
	uiShowWindow.Call(window, 5) // SW_SHOW
	uiSetFocus.Call(u.stopButton)

	go func() { u.stopReady <- start(u.notify) }()
	go func() {
		for {
			select {
			case _, ok := <-reopen:
				if !ok {
					return
				}
				u.post(wmReopenLauncher)
			case <-u.done:
				return
			}
		}
	}()

	var msg uiMessage
	for {
		result, _, err := uiGetMessage.Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0)
		if int32(result) == -1 {
			u.beginStop()
			return launcherWinError("Receber mensagens da janela", err)
		}
		if result == 0 {
			return nil
		}
		if handled, _, _ := uiIsDialogMessage.Call(window, uintptr(unsafe.Pointer(&msg))); handled == 0 {
			uiTranslateMessage.Call(uintptr(unsafe.Pointer(&msg)))
			uiDispatchMessage.Call(uintptr(unsafe.Pointer(&msg)))
		}
	}
}

func (u *launcherUI) createControls(instance uintptr) error {
	controls := []struct {
		dest          *uintptr
		class, text   string
		style, ex, id uintptr
	}{
		{&u.title, "STATIC", "Frota Estelar", 0, 0, 0},
		{&u.status, "EDIT", "Preparando o jogo...\r\nA primeira inicialização pode levar alguns instantes.", 0x00210844, 0x200, 0},
		{&u.note, "STATIC", "Fechar o navegador não encerra o jogo. Use Encerrar.", 0, 0, 0},
		{&u.openButton, "BUTTON", "Abrir jogo", 0x00010001, 0, launcherOpenID},
		{&u.stopButton, "BUTTON", "Encerrar", 0x00010000, 0, launcherStopID},
	}
	for _, c := range controls {
		handle, _, err := uiCreateWindow.Call(c.ex, uintptr(unsafe.Pointer(launcherUTF16(c.class))),
			uintptr(unsafe.Pointer(launcherUTF16(c.text))), 0x50000000|c.style,
			0, 0, 0, 0, u.window, c.id, instance, 0) // WS_CHILD | WS_VISIBLE
		if handle == 0 {
			return launcherWinError("Criar controle da janela", err)
		}
		*c.dest = handle
	}
	return nil
}

func (u *launcherUI) notify(update uiUpdate) {
	u.mu.Lock()
	defer u.mu.Unlock()
	if u.closed {
		return
	}
	if update.Status != "" {
		u.pending.Status = update.Status
	}
	if update.GameURL != "" {
		u.pending.GameURL = update.GameURL
		u.pending.Failed = false
	}
	if update.Failed {
		u.pending.GameURL = ""
		u.pending.Failed = true
	}
	if !u.hasPending {
		u.hasPending = true
		uiPostMessage.Call(u.window, wmLauncherUpdate, 0, 0)
	}
}

func (u *launcherUI) post(message uintptr) {
	u.mu.Lock()
	defer u.mu.Unlock()
	if !u.closed {
		uiPostMessage.Call(u.window, message, 0, 0)
	}
}

func (u *launcherUI) applyUpdate() {
	u.mu.Lock()
	update := u.pending
	u.pending, u.hasPending = uiUpdate{}, false
	u.mu.Unlock()
	if u.closing {
		return
	}
	if update.Status != "" {
		launcherSetText(u.status, update.Status)
	}
	if update.Failed {
		u.gameURL = ""
		uiEnableWindow.Call(u.openButton, 0)
		return
	}
	if update.GameURL != "" {
		u.gameURL = update.GameURL
		uiEnableWindow.Call(u.openButton, 1)
		if !u.openedBrowser {
			u.openedBrowser = true
			u.openGame()
		}
	}
}

func (u *launcherUI) openGame() {
	if u.closing || u.gameURL == "" {
		return
	}
	gameURL := u.gameURL
	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
		result, _, _ := uiCoInitialize.Call(0, 0x6) // Apartment threading, no legacy OLE DDE.
		if int32(result) >= 0 {
			defer uiCoUninitialize.Call()
		}
		result, _, _ = uiShellExecute.Call(0, uintptr(unsafe.Pointer(launcherUTF16("open"))),
			uintptr(unsafe.Pointer(launcherUTF16(gameURL))), 0, 0, 1)
		if result <= 32 {
			u.mu.Lock()
			if !u.closed {
				u.failedBrowserURL = gameURL
				uiPostMessage.Call(u.window, wmBrowserFailed, 0, 0)
			}
			u.mu.Unlock()
		}
	}()
}

func (u *launcherUI) reopen() {
	if iconic, _, _ := uiIsIconic.Call(u.window); iconic != 0 {
		uiShowWindow.Call(u.window, 9) // SW_RESTORE
	} else {
		uiShowWindow.Call(u.window, 5)
	}
	uiSetForegroundWindow.Call(u.window)
	u.openGame()
}

func (u *launcherUI) beginStop() {
	if u.closing {
		return
	}
	u.closing = true
	uiEnableWindow.Call(u.openButton, 0)
	uiEnableWindow.Call(u.stopButton, 0)
	launcherSetText(u.status, "Encerrando o jogo...\nAguarde enquanto os processos são finalizados.")
	// Normal cleanup is bounded by the caller. The timer also covers a stalled
	// startup or cleanup callback without freezing the message-loop thread.
	uiSetTimer.Call(u.window, launcherStopTimer, 8000, 0)
	go func() {
		select {
		case stop := <-u.stopReady:
			if stop != nil {
				stop()
			}
			u.post(wmLauncherStopped)
		case <-u.done:
		}
	}()
}

func launcherWindowProc(window uintptr, message uint32, wParam, lParam uintptr) uintptr {
	u := activeLauncherUI
	if u == nil || (u.window != 0 && window != u.window) {
		result, _, _ := uiDefWindowProc.Call(window, uintptr(message), wParam, lParam)
		return result
	}
	if u.window == 0 {
		u.window = window
	}
	switch message {
	case 0x0005: // WM_SIZE
		if wParam != 1 { // SIZE_MINIMIZED
			u.layout()
		}
		return 0
	case 0x0024: // WM_GETMINMAXINFO
		var limits uiMinMaxInfo
		uiCopyMemory.Call(uintptr(unsafe.Pointer(&limits)), lParam, unsafe.Sizeof(limits))
		width, height := u.windowSize(480, 300)
		limits.MinTrackSize = uiPoint{int32(width), int32(height)}
		uiCopyMemory.Call(lParam, uintptr(unsafe.Pointer(&limits)), unsafe.Sizeof(limits))
		return 0
	case 0x02E0: // WM_DPICHANGED
		u.dpi = int(wParam & 0xFFFF)
		var bounds uiRect
		uiCopyMemory.Call(uintptr(unsafe.Pointer(&bounds)), lParam, unsafe.Sizeof(bounds))
		uiSetWindowPos.Call(window, 0, uintptr(bounds.Left), uintptr(bounds.Top),
			uintptr(bounds.Right-bounds.Left), uintptr(bounds.Bottom-bounds.Top), 0x14)
		u.setFonts()
		u.layout()
		return 0
	case 0x0111: // WM_COMMAND
		switch wParam & 0xFFFF {
		case launcherOpenID, 1: // Button, or Enter through IsDialogMessage.
			u.openGame()
		case launcherStopID, 2:
			u.beginStop()
		}
		return 0
	case 0x0010: // WM_CLOSE
		u.beginStop()
		return 0
	case 0x0113: // WM_TIMER
		if wParam == launcherStopTimer && u.closing {
			uiDestroyWindow.Call(window)
		}
		return 0
	case wmLauncherStopped:
		uiKillTimer.Call(window, launcherStopTimer)
		uiDestroyWindow.Call(window)
		return 0
	case wmLauncherUpdate:
		u.applyUpdate()
		return 0
	case wmBrowserFailed:
		u.mu.Lock()
		url := u.failedBrowserURL
		u.failedBrowserURL = ""
		u.mu.Unlock()
		// A delayed browser failure must not replace a server failure or a
		// shutdown status that arrived while ShellExecute was running.
		if !u.closing && url != "" && url == u.gameURL {
			launcherSetText(u.status, "O jogo está disponível, mas não foi possível abrir o navegador.\nAbra este endereço no navegador:\n"+url)
		}
		return 0
	case wmReopenLauncher:
		u.reopen()
		return 0
	case 0x0002: // WM_DESTROY
		uiPostQuitMessage.Call(0)
		return 0
	}
	result, _, _ := uiDefWindowProc.Call(window, uintptr(message), wParam, lParam)
	return result
}

func (u *launcherUI) layout() {
	if u.stopButton == 0 {
		return
	}
	var bounds uiRect
	uiGetClientRect.Call(u.window, uintptr(unsafe.Pointer(&bounds)))
	width, height := int(bounds.Right), int(bounds.Bottom)
	px := func(value int) int { return launcherPixels(value, u.dpi) }
	margin, buttonWidth, buttonHeight := px(18), px(124), px(34)
	buttonsY := height - margin - buttonHeight
	noteY, statusY := buttonsY-px(48), px(54)
	move := func(window uintptr, x, y, w, h int) {
		uiMoveWindow.Call(window, uintptr(x), uintptr(y), uintptr(w), uintptr(h), 1)
	}
	move(u.title, margin, px(14), width-2*margin, px(30))
	move(u.status, margin, statusY, width-2*margin, noteY-px(12)-statusY)
	move(u.note, margin, noteY, width-2*margin, px(36))
	move(u.openButton, width-margin-2*buttonWidth-px(10), buttonsY, buttonWidth, buttonHeight)
	move(u.stopButton, width-margin-buttonWidth, buttonsY, buttonWidth, buttonHeight)
}

func (u *launcherUI) setFonts() {
	if u.stopButton == 0 {
		return
	}
	newFont := func(size, weight int) uintptr {
		font, _, _ := uiCreateFont.Call(uintptr(int32(-launcherPixels(size, u.dpi))), 0, 0, 0,
			uintptr(weight), 0, 0, 0, 1, 0, 0, 5, 0, uintptr(unsafe.Pointer(launcherUTF16("Segoe UI"))))
		return font
	}
	oldFont, oldTitleFont := u.font, u.titleFont
	u.font, u.titleFont = newFont(14, 400), newFont(22, 600)
	for _, handle := range []uintptr{u.status, u.note, u.openButton, u.stopButton} {
		uiSendMessage.Call(handle, 0x0030, u.font, 1) // WM_SETFONT
	}
	uiSendMessage.Call(u.title, 0x0030, u.titleFont, 1)
	uiDeleteObject.Call(oldFont)
	uiDeleteObject.Call(oldTitleFont)
}

func (u *launcherUI) windowSize(width, height int) (int, int) {
	bounds := uiRect{Right: int32(launcherPixels(width, u.dpi)), Bottom: int32(launcherPixels(height, u.dpi))}
	if uiAdjustWindowRectForDPI.Find() == nil {
		uiAdjustWindowRectForDPI.Call(uintptr(unsafe.Pointer(&bounds)), launcherWindowStyle, 0, 0x00010000, uintptr(u.dpi))
	} else {
		uiAdjustWindowRect.Call(uintptr(unsafe.Pointer(&bounds)), launcherWindowStyle, 0, 0x00010000)
	}
	return int(bounds.Right - bounds.Left), int(bounds.Bottom - bounds.Top)
}

func setLauncherDPIAwareness() {
	if uiSetDPIAwarenessContext.Find() == nil {
		if result, _, _ := uiSetDPIAwarenessContext.Call(^uintptr(3)); result != 0 { // PER_MONITOR_AWARE_V2
			return
		}
	}
	if uiSetProcessDPIAware.Find() == nil {
		uiSetProcessDPIAware.Call()
	}
}

func launcherScreenDPI() int {
	dc, _, _ := uiGetDC.Call(0)
	if dc != 0 {
		defer uiReleaseDC.Call(0, dc)
		if dpi, _, _ := uiGetDeviceCaps.Call(dc, 90); dpi > 0 { // LOGPIXELSY
			return int(dpi)
		}
	}
	return 96
}

func launcherPixels(value, dpi int) int { return (value*dpi + 48) / 96 }

func launcherUTF16(value string) *uint16 {
	text, _ := syscall.UTF16PtrFromString(strings.ReplaceAll(value, "\x00", ""))
	return text
}

func launcherSetText(window uintptr, value string) {
	value = strings.ReplaceAll(strings.ReplaceAll(value, "\r\n", "\n"), "\n", "\r\n")
	uiSetWindowText.Call(window, uintptr(unsafe.Pointer(launcherUTF16(value))))
}

func launcherWinError(operation string, err error) error {
	if err == nil || err == syscall.Errno(0) {
		return fmt.Errorf("%s falhou", operation)
	}
	return fmt.Errorf("%s: %w", operation, err)
}
