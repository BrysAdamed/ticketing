import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { ToastService } from './toast.service';

const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setTimeout(resolve));
};

describe('ToastService.whenIdle', () => {
  let toasts: ToastService;
  let idle: boolean;

  function watchIdle(): void {
    idle = false;
    void toasts.whenIdle().then(() => (idle = true));
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    toasts = TestBed.inject(ToastService);
  });

  it('resolves at once while no toast is open', async () => {
    // Act
    watchIdle();
    await settle();

    // Assert
    expect(idle).toBe(true);
  });

  it('waits until the open toast is dismissed', async () => {
    // Arrange
    const ref = toasts.show('Deleted "Payment flows"', { durationMs: 60_000 });

    // Act
    watchIdle();
    await settle();
    const whileOpen = idle;
    ref.dismiss();
    await settle();

    // Assert
    expect(whileOpen).toBe(false);
    expect(idle).toBe(true);
  });

  it('keeps waiting when a newer toast replaces the open one', async () => {
    // Arrange
    toasts.show('First', { durationMs: 60_000 });
    watchIdle();

    // Act
    const second = toasts.show('Second', { durationMs: 60_000 });
    await settle();
    const whileSecondOpen = idle;
    second.dismiss();
    await settle();

    // Assert
    expect(whileSecondOpen).toBe(false);
    expect(idle).toBe(true);
  });
});
