/**
 * Message item component
 */

import {
  h,
} from 'preact';

import {
  linkifyText,
} from '../utils';

interface MessageItemProps {
  type: 'system' | 'extern' | 'self';
  message: string;
  description: string;
}

const MessageItem = (props: MessageItemProps) => (
  <li data-type={props.type}>
    <div
      dangerouslySetInnerHTML={{ __html: linkifyText(props.message) }}
      class="message-content" />
    <div class="message-description">
      {props.description}
    </div>
  </li>
);

export default MessageItem;
