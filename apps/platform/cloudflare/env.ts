import type { InferEnv, UnwrapConfig } from 'cf/config';
import type { worker } from '../cloudflare.config';
import type { RegistryJobParams } from './workflows';

type ConfiguredEnv = InferEnv<UnwrapConfig<typeof worker>>;

/** Binding types derive from the deploy configuration; only the Workflow payload is refined. */
export type CloudflareEnv = Omit<ConfiguredEnv, 'REGISTRY_JOBS'> & {
  REGISTRY_JOBS: Workflow<RegistryJobParams>;
};
