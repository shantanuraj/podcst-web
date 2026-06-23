const pem = (value?: string) => value?.replace(/\\n/g, '\n');

const ca = pem(process.env.MTLS_CA);

export const mtls = ca
  ? {
      ca,
      cert: pem(process.env.MTLS_CERT),
      key: pem(process.env.MTLS_KEY),
      rejectUnauthorized: true,
    }
  : undefined;
