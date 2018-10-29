/**
 * Index redirect
 */

import { PureComponent } from 'react';
import { RouteComponentProps } from 'react-router-dom';

class IndexRedirect extends PureComponent<RouteComponentProps<null>, {}> {
  public componentDidMount() {
    this.props.history.push('/feed/top');
  }

  public render() {
    return null;
  }
}

export default IndexRedirect;
