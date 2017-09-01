/**
 * Messages component
 */

import {
  h,
} from 'preact';

import MessageItem from './MessageItem';

interface MessagesProps {
  address: string;
  texts: ShareText.Text[];
}

const renderTexts = (props: MessagesProps) => {
  const {
    address,
    texts,
  } = props;

  const header = (
    <MessageItem
      type='system'
      message={`Chat with ${address}`}
      description={new Date(texts[0].date).toDateString()}
    />
  );

  const messages = texts.map(text =>
    <MessageItem
      type={text.sent ? 'self' : 'extern'}
      message={text.message}
      description={`Sent at ${new Date(text.date).toDateString()}`}
    />
  );

  return [ header, ...messages ];
}

const Messages = (props: MessagesProps) => (
  <div class="messages-view" style="height: 100%; position: relative;">
    <ul class="messages">
      {renderTexts(props)}
    </ul>
  </div>
);

export default Messages;
