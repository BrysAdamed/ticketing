import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';

@Injectable()
export class NotFoundStore {
  readonly url = inject(Router).url;
  readonly message = `${this.url} doesn't exist or was moved.`;
}
