import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { GLOBAL_ROLE_LABELS } from '@shared/domain/enums';
import {
  matchingPasswords,
  PASSWORD_HINT,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '@shared/domain/password-policy';
import { AvatarComponent } from '@shared/ui/domain/avatar.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { AchievementsCardComponent } from './achievements-card.component';
import { AvatarCardComponent } from './avatar-card.component';
import { ProfileGeneralStore } from './profile-general.store';

@Component({
  selector: 'tk-profile-general-view',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    AvatarComponent,
    AvatarCardComponent,
    AchievementsCardComponent,
    IconComponent,
  ],
  providers: [ProfileGeneralStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tk-page', 'data-testid': 'view-profile.general' },
  templateUrl: './profile-general.view.html',
  styleUrl: './profile-general.view.scss',
})
export class ProfileGeneralView {
  protected readonly store = inject(ProfileGeneralStore);
  protected readonly roleLabels = GLOBAL_ROLE_LABELS;
  protected readonly hint = PASSWORD_HINT;
  protected readonly minLength = PASSWORD_MIN_LENGTH;

  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly nameForm = this.fb.group({
    displayName: ['', [Validators.required, Validators.maxLength(100)]],
  });

  protected readonly passwordForm = this.fb.group(
    {
      currentPassword: ['', Validators.required],
      newPassword: [
        '',
        [
          Validators.required,
          Validators.minLength(PASSWORD_MIN_LENGTH),
          Validators.maxLength(PASSWORD_MAX_LENGTH),
        ],
      ],
      confirm: ['', Validators.required],
    },
    { validators: matchingPasswords('newPassword', 'confirm') },
  );

  constructor() {
    effect(() => {
      const user = this.store.user();
      if (user && !this.nameForm.dirty) this.nameForm.reset({ displayName: user.displayName });
    });
  }

  protected async saveName(): Promise<void> {
    if (this.nameForm.invalid) {
      this.nameForm.markAllAsTouched();
      return;
    }
    if (await this.store.saveDisplayName(this.nameForm.getRawValue().displayName)) {
      this.nameForm.reset({ displayName: this.store.user()?.displayName ?? '' });
    }
  }

  protected async changePassword(): Promise<void> {
    if (this.passwordForm.invalid) {
      this.passwordForm.markAllAsTouched();
      return;
    }
    const { currentPassword, newPassword } = this.passwordForm.getRawValue();
    if (await this.store.changePassword(currentPassword, newPassword)) this.passwordForm.reset();
  }
}
