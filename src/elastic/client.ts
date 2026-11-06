import { Client } from '@elastic/elasticsearch';
import { elasticsearchOptions } from '../config/configuration';

/** Client for CLI scripts (migrate, seed), configured from the same env vars as the app. */
export const createScriptClient = (): Client => new Client(elasticsearchOptions());
