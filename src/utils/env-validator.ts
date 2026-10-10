import { Logger } from '@nestjs/common';

type EnvDefinition = {
  name: string;
  description: string;
  // When set, the env is optional and this value is used if it is missing
  defaultValue?: string;
  isUrl?: boolean;
};

// Add new envs here. Envs without a defaultValue are mandatory.
export const ENV_DEFINITIONS: EnvDefinition[] = [
  {
    name: 'SSI_API_DOMAIN',
    description: 'Base URL of the SSI API service',
    isUrl: true,
  },
  {
    name: 'CAVACH_API_DOMAIN',
    description: 'Base URL of the Cavach (KYC) API service',
    isUrl: true,
  },
  {
    name: 'CLIENT_APP_URL',
    description: 'URL of the developer dashboard frontend',
    isUrl: true,
  },
  {
    name: 'KYC_WIDGET_URL',
    description: 'URL of the KYC widget',
    defaultValue: 'https://verify.hypersign.id',
    isUrl: true,
  },
  {
    name: 'KYB_WIDGET_URL',
    description: 'URL of the KYB widget',
    defaultValue: 'https://verify.business.hypersign.id',
    isUrl: true,
  },
  {
    name: 'KYC_VERIFIER_APP_BASE_URL',
    description: 'Base URL of the KYC verifier app',
    defaultValue: 'https://verifier.hypersign.id',
    isUrl: true,
  },
  {
    name: 'MNEMONIC',
    description: 'Mnemonic for key generations',
    isUrl: false,
  },
];

function isEmpty(value: string | undefined): boolean {
  return (
    value === undefined ||
    value.trim() === '' ||
    value.trim() === 'undefined' ||
    value.trim() === 'null'
  );
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validates envs listed in ENV_DEFINITIONS before the service starts.
 * - Optional envs that are missing are set to their default value in process.env,
 *   so ConfigService.get() returns the default everywhere.
 * - If any mandatory env is missing or any URL env is invalid, all problems are
 *   logged together and the process exits.
 */
export function validateEnv(): void {
  const missing: EnvDefinition[] = [];
  const invalid: { def: EnvDefinition; value: string }[] = [];

  for (const def of ENV_DEFINITIONS) {
    let value = process.env[def.name];

    if (isEmpty(value)) {
      if (def.defaultValue === undefined) {
        missing.push(def);
        continue;
      }
      value = def.defaultValue;
      process.env[def.name] = value;
      Logger.warn(
        `${def.name} is not set, using default value: ${value}`,
        'EnvValidator',
      );
    }

    if (def.isUrl && !isValidUrl(value.trim())) {
      invalid.push({ def, value });
    }
  }

  if (missing.length === 0 && invalid.length === 0) {
    Logger.log('All required environment variables are set', 'EnvValidator');
    return;
  }

  const lines: string[] = [
    '',
    '================ ENVIRONMENT CONFIGURATION ERROR ================',
  ];
  if (missing.length > 0) {
    lines.push('The following mandatory environment variables are not set:');
    missing.forEach((def) => lines.push(`  - ${def.name}: ${def.description}`));
  }
  if (invalid.length > 0) {
    lines.push('The following environment variables have invalid values:');
    invalid.forEach(({ def, value }) =>
      lines.push(
        `  - ${def.name}="${value}": expected a valid http(s) URL (${def.description})`,
      ),
    );
  }
  lines.push(
    'Please set these in your .env file (see env.sample) and restart the service.',
    '=================================================================',
  );

  Logger.error(lines.join('\n'), 'EnvValidator');
  process.exit(1);
}
