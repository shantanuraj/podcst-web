const appleApps = ['DBD4H768ZS.app.podcst.ios'];

const androidApps = [
  {
    packageName: 'app.podcst.android',
    fingerprints: [
      '87:BF:91:7A:3C:54:A3:EA:FE:4F:58:D4:CD:30:44:61:61:C8:1E:18:4A:05:AB:3E:A1:15:7C:B7:85:50:46:5F',
      'EB:09:43:81:1D:7D:86:E2:A2:FE:20:36:49:20:B1:E0:48:80:48:7E:7A:D0:26:F5:43:5B:6C:2A:27:41:98:D8',
      'B5:24:60:6D:3E:F7:3C:F3:59:0D:DC:84:74:38:B6:2F:F7:57:4C:4C:BD:99:5A:40:02:A8:04:95:67:F2:A4:00',
      'C9:09:42:58:D0:47:30:ED:ED:9C:61:DB:BF:59:E5:90:0A:13:98:69:B6:61:B1:8F:B5:43:DD:2F:67:DE:91:A7',
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
