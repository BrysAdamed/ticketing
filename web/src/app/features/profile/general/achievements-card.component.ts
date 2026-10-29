import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  Injector,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { provideIcons } from '@ng-icons/core';
import { tablerAward } from '@ng-icons/tabler-icons';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { ProfileGeneralStore } from './profile-general.store';

/// Profile → Achievements opt-out (TKT-68, spec 15.11): on by default; turning it off asks inline
/// first because it deletes the user's achievements and shares.
@Component({
  selector: 'tk-achievements-card',
  imports: [MatButtonModule, IconComponent],
  viewProviders: [provideIcons({ tablerAward })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './achievements-card.component.html',
  styleUrl: './achievements-card.component.scss',
})
export class AchievementsCardComponent {
  protected readonly store = inject(ProfileGeneralStore);
  private readonly injector = inject(Injector);
  private readonly toggleButton = viewChild.required<ElementRef<HTMLButtonElement>>('toggleButton');
  private readonly keepButton = viewChild<ElementRef<HTMLButtonElement>>('keepButton');

  protected toggle(): void {
    this.store.toggleAchievements();
    if (this.store.confirmingOptOut()) {
      afterNextRender(() => this.keepButton()?.nativeElement.focus(), { injector: this.injector });
    }
  }

  protected keep(): void {
    this.store.cancelOptOut();
    this.toggleButton().nativeElement.focus();
  }

  protected async confirm(): Promise<void> {
    const saving = this.store.confirmOptOut();
    this.toggleButton().nativeElement.focus();
    await saving;
  }
}
