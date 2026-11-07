import { Injectable } from '@nestjs/common';

/** Today's date (YYYY-MM-DD, UTC). Injected so tests can pin "now". */
@Injectable()
export class Clock {
  today(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
