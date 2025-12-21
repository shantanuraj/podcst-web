export const Schema = ({ data }: { data: object }) => {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: This is required for ld+json
    />
  );
};
