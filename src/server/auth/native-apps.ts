const appleApps = ['DBD4H768ZS.app.podcst.ios'];

const androidApps = [
  {
    packageName: 'app.podcst.android',
    fingerprints: [
      '87:BF:91:7A:3C:54:A3:EA:FE:4F:58:D4:CD:30:44:61:61:C8:1E:18:4A:05:AB:3E:A1:15:7C:B7:85:50:46:5F',
    ],
  },
];

export const appleAppSiteAssociation = {
  applinks: {
    details: [
      {
        appIDs: appleApps,
        components: [
          { '/': '/episodes/*%*', exclude: true },
          { '/': '/episodes/*/*/*', exclude: true },
          { '/': '/episodes/*' },
        ],
      },
    ],
  },
  webcredentials: { apps: appleApps },
};

export const assetLinks = androidApps.map((app) => ({
  relation: [
    'delegate_permission/common.get_login_creds',
    'delegate_permission/common.handle_all_urls',
  ],
  target: {
    namespace: 'android_app',
    package_name: app.packageName,
    sha256_cert_fingerprints: app.fingerprints,
  },
}));

export function androidOrigin(fingerprint: string): string {
  const digest = Buffer.from(fingerprint.replaceAll(':', ''), 'hex');
  return `android:apk-key-hash:${digest.toString('base64url')}`;
}

export function acceptedOrigins(rpId: string, webOrigin: string): string[] {
  const apple = rpId === 'localhost' ? 'http://localhost' : `https://${rpId}`;
  const android = androidApps.flatMap((app) =>
    app.fingerprints.map(androidOrigin),
  );
  return Array.from(new Set([webOrigin, apple, ...android]));
}
