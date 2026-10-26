import {
  DestroyRef,
  EnvironmentProviders,
  inject,
  Injectable,
  provideEnvironmentInitializer,
  signal,
} from '@angular/core';
import { Command, SearchProvider } from './command';

/// Registry behind the command palette and the "New …" buttons. Features register commands and
/// search providers here; registrations made from components/route injectors are removed when
/// those are destroyed.
@Injectable({ providedIn: 'root' })
export class CommandRegistry {
  private readonly commandList = signal<readonly Command[]>([]);
  private readonly providerList = signal<readonly SearchProvider[]>([]);

  readonly commands = this.commandList.asReadonly();
  readonly providers = this.providerList.asReadonly();

  registerCommands(commands: readonly Command[], destroyRef?: DestroyRef): () => void {
    const ids = new Set(commands.map((c) => c.id));
    this.commandList.update((list) => [...list.filter((c) => !ids.has(c.id)), ...commands]);
    const remove = () =>
      this.commandList.update((list) => list.filter((c) => !commands.includes(c)));
    destroyRef?.onDestroy(remove);
    return remove;
  }

  registerSearchProvider(provider: SearchProvider, destroyRef?: DestroyRef): () => void {
    this.providerList.update((list) => [...list.filter((p) => p.id !== provider.id), provider]);
    const remove = () => this.providerList.update((list) => list.filter((p) => p !== provider));
    destroyRef?.onDestroy(remove);
    return remove;
  }

  find(id: string): Command | undefined {
    const command = this.commandList().find((c) => c.id === id);
    return command && (command.available?.() ?? true) ? command : undefined;
  }

  run(id: string): boolean {
    const command = this.find(id);
    command?.run();
    return command !== undefined;
  }
}

/// Registers commands when the providing environment injector (app or lazy route) is created.
export function provideCommands(factory: () => readonly Command[]): EnvironmentProviders {
  return provideEnvironmentInitializer(() => {
    inject(CommandRegistry).registerCommands(factory(), inject(DestroyRef));
  });
}

export function provideSearchProvider(factory: () => SearchProvider): EnvironmentProviders {
  return provideEnvironmentInitializer(() => {
    inject(CommandRegistry).registerSearchProvider(factory(), inject(DestroyRef));
  });
}
