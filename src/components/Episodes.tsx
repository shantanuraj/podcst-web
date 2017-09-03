import { h } from 'preact';

interface EpisodesProps {
  path?: string;
  feed?: string;
}

const Episodes = ({
  feed,
}: EpisodesProps) => (
  <div>{feed}</div>
);

export default Episodes;
