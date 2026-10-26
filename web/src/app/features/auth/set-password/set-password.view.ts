import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { RouterLink } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import { tablerEye, tablerEyeOff } from '@ng-icons/tabler-icons';
import { ThemeService } from '@core/theme/theme.service';
import {
  matchingPasswords,
  PASSWORD_HINT,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '@shared/domain/password-policy';
import { RelativeTimePipe } from '@shared/pipes/relative-time.pipe';
import { EmptyStateComponent } from '@shared/ui/empty-state/empty-state.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { SetPasswordStore } from './set-password.store';

@Component({
  selector: 'tk-set-password-view',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    IconComponent,
    EmptyStateComponent,
    RelativeTimePipe,
  ],
  providers: [SetPasswordStore],
  viewProviders: [provideIcons({ tablerEye, tablerEyeOff })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'view-auth.set-password' },
  templateUrl: './set-password.view.html',
  styleUrl: './set-password.view.scss',
})
export class SetPasswordView {
  protected readonly store = inject(SetPasswordStore);
  protected readonly theme = inject(ThemeService);
  protected readonly hint = PASSWORD_HINT;
  protected readonly minLength = PASSWORD_MIN_LENGTH;

  readonly token = input<string | null>(null);

  protected readonly showPassword = signal(false);
  protected readonly form = inject(NonNullableFormBuilder).group(
    {
      password: [
        '',
        [
          Validators.required,
          Validators.minLength(PASSWORD_MIN_LENGTH),
          Validators.maxLength(PASSWORD_MAX_LENGTH),
        ],
      ],
      confirm: ['', Validators.required],
    },
    { validators: matchingPasswords('password', 'confirm') },
  );

  constructor() {
    effect(() => void this.store.load({ token: this.token() }));
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    void this.store.submit(this.form.getRawValue().password);
  }
}
