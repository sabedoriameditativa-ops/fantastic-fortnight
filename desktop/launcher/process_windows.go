//go:build windows

package main

import (
	"bufio"
	"context"
	_ "embed"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"
	"unsafe"
)

//go:embed payload.zip
var embeddedPayload []byte

const createNoWindow = 0x08000000

// Windows JOB_OBJECT_EXTENDED_LIMIT_INFORMATION, x64 layout. The job handle
// belongs only to the launcher: a crash also closes it and kills Node/workers.
type jobLimits struct {
	PerProcessUserTimeLimit int64
	PerJobUserTimeLimit     int64
	LimitFlags              uint32
	MinimumWorkingSetSize   uintptr
	MaximumWorkingSetSize   uintptr
	ActiveProcessLimit      uint32
	Affinity                uintptr
	PriorityClass           uint32
	SchedulingClass         uint32
	IOCounters              [6]uint64
	ProcessMemoryLimit      uintptr
	JobMemoryLimit          uintptr
	PeakProcessMemoryUsed   uintptr
	PeakJobMemoryUsed       uintptr
}

type processJob struct{ handle uintptr }

func newProcessJob() (*processJob, error) {
	handle, _, err := kernel32.NewProc("CreateJobObjectW").Call(0, 0)
	if handle == 0 {
		return nil, err
	}
	limits := jobLimits{LimitFlags: 0x2000} // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	ok, _, err := kernel32.NewProc("SetInformationJobObject").Call(handle, 9, uintptr(unsafe.Pointer(&limits)), unsafe.Sizeof(limits))
	if ok == 0 {
		closeHandle.Call(handle)
		return nil, err
	}
	return &processJob{handle: handle}, nil
}

func (job *processJob) attach(pid int) error {
	process, _, err := kernel32.NewProc("OpenProcess").Call(0x0100|0x0001, 0, uintptr(pid)) // SET_QUOTA | TERMINATE
	if process == 0 {
		return err
	}
	defer closeHandle.Call(process)
	ok, _, err := kernel32.NewProc("AssignProcessToJobObject").Call(job.handle, process)
	if ok == 0 {
		return err
	}
	return nil
}

func (job *processJob) close() {
	if job != nil && job.handle != 0 {
		closeHandle.Call(job.handle)
		job.handle = 0
	}
}

func startDesktop(notify func(uiUpdate)) func() {
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		if err := launchDesktop(ctx, notify); err != nil && ctx.Err() == nil {
			notify(uiUpdate{Status: err.Error() + "\n\nFeche esta janela e abra o Frota Estelar novamente para tentar outra vez.", Failed: true})
		}
	}()
	return func() {
		cancel()
		select {
		case <-done:
		case <-time.After(6 * time.Second):
		}
	}
}

func launchDesktop(ctx context.Context, notify func(uiUpdate)) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	local := os.Getenv("LOCALAPPDATA")
	if local == "" || !filepath.IsAbs(local) {
		return errors.New("Não foi possível localizar a pasta privada de aplicativos do Windows (LOCALAPPDATA).")
	}
	base := filepath.Join(local, "FrotaEstelar")
	dataDir := filepath.Join(base, "data")
	logDir := filepath.Join(base, "logs")
	for _, dir := range []string{dataDir, logDir} {
		if err := os.MkdirAll(dir, 0700); err != nil {
			return fmt.Errorf("Não foi possível preparar a pasta de dados: %w", err)
		}
	}
	logFile, err := os.OpenFile(filepath.Join(logDir, "launcher.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if err != nil {
		return fmt.Errorf("Não foi possível abrir o registro do aplicativo: %w", err)
	}
	defer logFile.Close()
	logger := log.New(logFile, "", log.LstdFlags)
	notify(uiUpdate{Status: "Preparando o jogo…\nNa primeira abertura, o aplicativo extrai seus arquivos privados. Seu progresso é mantido entre versões."})
	runtimeDir, err := installPayload(ctx, filepath.Join(base, "runtime"), embeddedPayload)
	if err != nil {
		logger.Printf("extração: %v", err)
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	job, err := newProcessJob()
	if err != nil {
		return fmt.Errorf("Não foi possível preparar o encerramento seguro do servidor: %w", err)
	}
	defer job.close()
	appDir := filepath.Join(runtimeDir, "app")
	cmd := exec.Command(filepath.Join(runtimeDir, "node.exe"), filepath.Join(appDir, "server", "desktop.js"))
	cmd.Dir = appDir
	cmd.Env = nodeEnvironment(os.Environ(), dataDir)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	defer stdin.Close()
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	cmd.Stderr = logFile
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("Não foi possível iniciar o servidor do jogo: %w", err)
	}
	if err := job.attach(cmd.Process.Pid); err != nil {
		cmd.Process.Kill()
		cmd.Wait()
		return fmt.Errorf("Não foi possível proteger o processo do jogo: %w", err)
	}
	wait := make(chan error, 1)
	scanDone := make(chan struct{})
	messages := make(chan serverMessage, 8)
	go func() {
		defer close(scanDone)
		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 4096), 256*1024)
		for scanner.Scan() {
			message, err := parseServerMessage(scanner.Bytes())
			if err != nil {
				logger.Printf("resposta inválida do servidor: %v", err)
				continue
			}
			select {
			case messages <- message:
			case <-ctx.Done():
				return
			}
		}
		if err := scanner.Err(); err != nil && ctx.Err() == nil {
			logger.Printf("leitura do servidor: %v", err)
		}
	}()
	go func() {
		// Wait closes StdoutPipe, so first let the scanner drain the final
		// structured error emitted immediately before a failed startup exits.
		<-scanDone
		wait <- cmd.Wait()
	}()
	stop := func() {
		cancel() // also releases a scanner waiting to deliver a final message
		io.WriteString(stdin, "shutdown\n")
		stdin.Close()
		select {
		case <-wait:
		case <-time.After(4 * time.Second):
			job.close()
			select {
			case <-wait:
			case <-time.After(time.Second):
			}
		}
	}
	readyTimer := time.NewTimer(30 * time.Second)
	defer readyTimer.Stop()
	notify(uiUpdate{Status: "Iniciando o servidor local…\nO navegador abrirá automaticamente quando o jogo estiver pronto."})
	ready := false
	for {
		select {
		case <-ctx.Done():
			stop()
			return ctx.Err()
		case message := <-messages:
			if message.Type == "error" {
				stop()
				return errors.New(message.Message)
			}
			if message.Type == "ready" && !ready {
				ready = true
				readyTimer.Stop()
				notify(uiUpdate{Status: "Jogo pronto em http://localhost:3000\n\nProgresso salvo neste computador.\nDados: " + dataDir, GameURL: message.URL})
			}
		case err := <-wait:
			// Preserve a structured startup error already read before process exit.
			for len(messages) > 0 {
				message := <-messages
				if message.Type == "error" {
					return errors.New(message.Message)
				}
			}
			logger.Printf("servidor encerrou: %v", err)
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return fmt.Errorf("O servidor do jogo foi encerrado. Consulte o registro em %s.", filepath.Join(logDir, "launcher.log"))
		case <-readyTimer.C:
			if !ready {
				stop()
				return errors.New("O servidor demorou demais para iniciar. Verifique se a porta 3000 está disponível e tente novamente.")
			}
		}
	}
}
