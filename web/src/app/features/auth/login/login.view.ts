import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { provideIcons } from '@ng-icons/core';
import { tablerEye, tablerEyeOff } from '@ng-icons/tabler-icons';
import { ThemeService } from '@core/theme/theme.service';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { LoginStore } from './login.store';

@Component({
  selector: 'tk-login-view',
  imports: [
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    IconComponent,
  ],
  providers: [LoginStore],
  viewProviders: [provideIcons({ tablerEye, tablerEyeOff })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './login.view.html',
  styleUrl: './login.view.scss',
})
export class LoginView {
  protected readonly store = inject(LoginStore);
  protected readonly theme = inject(ThemeService);

  readonly returnUrl = input<string | null>(null);

  protected readonly showPassword = signal(false);
  protected readonly form = inject(NonNullableFormBuilder).group({
    email: ['', [Validators.required, Validators.email, Validators.maxLength(254)]],
    password: ['', [Validators.required, Validators.maxLength(128)]],
  });
  protected readonly serverEmailError = computed(
    () => this.store.fieldErrors()['email']?.[0] ?? null,
  );
  protected readonly serverPasswordError = computed(
    () => this.store.fieldErrors()['password']?.[0] ?? null,
  );

  private readonly email = viewChild.required<ElementRef<HTMLInputElement>>('email');

  constructor() {
    afterNextRender(() => this.email().nativeElement.focus());
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    void this.store.signIn(this.form.getRawValue(), this.returnUrl());
  }
}
