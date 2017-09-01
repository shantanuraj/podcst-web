/**
 * Texts view component
 */

import {
  h,
} from 'preact';
import {
  orderBy,
} from 'lodash-es';

import {
  TextsState,
} from '../stores/texts';

import {
  getAvatar,
} from '../utils';

import {
  ListGroup,
  ListGroupHeader,
  Pane,
  PaneGroup,
  Sidebar,
  WindowContent,
} from './ProtonUI';

import Search from '../containers/Search';

import TextRow from './TextRow';
import LoadingView from './LoadingView';
import Messages from './Messages';

interface TextsViewProps extends TextsState {
  path: string;
  thread: string;
  showThread: (thread: string) => void;
}

const currentThread = (props: TextsViewProps): string => {
  if (props.thread) {
    return props.thread;
  }

  const [ firstThread ] = props.filteredThreads;
  const [ threadId ] = firstThread;

  return threadId;
}

const renderThread = (props: TextsViewProps) => {
  const thread = currentThread(props);
  const {
    filteredThreads,
  } = props;

  const foundThread = filteredThreads.find(([ threadId ]) => threadId === thread);

  if (foundThread) {
    const [
      ,
      texts,
    ] = foundThread;

    return (
      <Messages
        address={texts[0].address}
        texts={orderBy<ShareText.Text>(texts, text => text.date, 'asc')}
      />
    );
  } else {
    return <div />;
  }
}

const TextsView = (props: TextsViewProps) => (
  props.loading ?
  <LoadingView /> :
  <WindowContent>
    <PaneGroup>
      <Sidebar class="pane pane-sm">
        <ListGroup>
          <ListGroupHeader>
            <Search />
          </ListGroupHeader>
          {props.filteredThreads.map(([threadId, texts]) =>
          <TextRow
            active={currentThread(props) === threadId}
            avatar={getAvatar(texts[0].address)}
            address={texts[0].address}
            message={texts[0].message}
            showThread={() => props.showThread(threadId)}
          />
          )}
        </ListGroup>
      </Sidebar>
      <Pane>
        {renderThread(props)}
      </Pane>
    </PaneGroup>
  </WindowContent>
)

export default TextsView;
