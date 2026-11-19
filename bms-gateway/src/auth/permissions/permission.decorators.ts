import { SetMetadata } from '@nestjs/common';
export const Public = () => SetMetadata('public',true);
export const Authenticated = () => SetMetadata('authenticated',true);
