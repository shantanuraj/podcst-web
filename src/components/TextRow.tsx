/**
 * Text row component
 */

import {
  h,
} from 'preact';

import {
  ListGroupItem,
} from './ProtonUI';

interface TextRowProps {
  address: string;
  message: string;
  avatar: string;
  active: boolean;
  showThread: () => void;
}

const TextRow = (props: TextRowProps) => (
  <ListGroupItem onClick={() => props.showThread()} class={props.active ? 'active': ''}>
    <img class="img-circle media-object pull-left" src={props.avatar} width="32" height="32" />
    <div class="media-body">
      <strong>{props.address}</strong>
      <p>{props.message}</p>
    </div>
  </ListGroupItem>
);

export default TextRow;
