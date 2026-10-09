import { Parser } from 'htmlparser2';
import { FeedUnavailableError } from './feed-errors';
import { MAX_FEED_BYTES } from './feed-limits';

export function validateFeedXml(xml: string) {
  const refuse = () => {
    throw new FeedUnavailableError('Invalid or unsafe feed XML');
  };
  if (Buffer.byteLength(xml) > MAX_FEED_BYTES) refuse();
  let depth = 0;
  let nodes = 0;
  let attributes = 0;
  const parser = new Parser(
    {
      onopentagname(name) {
        attributes = 0;
        if (++depth > 64 || ++nodes > 250_000 || name.length > 256) refuse();
      },
      onattribute(name, value) {
        if (++attributes > 64 || name.length > 256 || value.length > 512 * 1024)
          refuse();
      },
      onclosetag() {
        depth--;
      },
      onprocessinginstruction(name) {
        if (name.startsWith('!')) refuse();
      },
    },
    { xmlMode: true, decodeEntities: false },
  );
  parser.end(xml);
}
