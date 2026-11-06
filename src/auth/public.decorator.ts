import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'intellect:isPublic';

/** Skips the auth guard (health probe, docs). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
