import { Global, Module } from '@nestjs/common';
import { TopicRollupService } from './topic-rollup.service';

@Global()
@Module({ providers: [TopicRollupService], exports: [TopicRollupService] })
export class TopicHealthModule {}
