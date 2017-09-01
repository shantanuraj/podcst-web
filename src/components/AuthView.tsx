/**
 * Auth component
 */

import {
  h,
  Component,
} from 'preact';

import {
  onEvent,
} from '../utils';
import {
  AuthState,
} from '../stores/auth';
import {
  WindowContent,
} from './ProtonUI';

const styles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
};

interface AuthProps {
  showTexts: () => void;
  onHostChange: (host: string) => void;
  onCodeChange: (code: string) => void;
}

class AuthView extends Component<AuthProps & AuthState, {}> {
  public render() {
    const {
      onCodeChange,
      onHostChange,
    } = this.props;

    return (
      <WindowContent style={styles.container}>
        <form>
          <div class="form-group">
            <label>Host</label>
            <input
              type="url"
              class="form-control"
              placeholder="Enter device IP and port"
              onInput={onEvent(onHostChange)}
            />
          </div>
          <div class="form-group">
            <label>Code</label>
            <input
              type="password"
              class="form-control"
              placeholder="Enter code from app"
              onInput={onEvent(onCodeChange)}
            />
          </div>
        </form>
      </WindowContent>
    );
  }

  public componentDidMount() {
    this.checkAuth();
  }

  public componentDidUpdate() {
    this.checkAuth();
  }

  private checkAuth() {
    const {
      authorized,
      showTexts,
    } = this.props;
    if (authorized) {
      showTexts();
    }
  }
}

export default AuthView;
