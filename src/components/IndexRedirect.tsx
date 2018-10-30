/**
 * Index redirect
 */

import * as React from 'react';
import { Redirect, RouteComponentProps } from 'react-router-dom';

const REDIRECT_PATH = '/feed/top';
class IndexRedirect extends React.PureComponent<RouteComponentProps<any>, {}> {
  public render() {
    if (this.props.location.pathname === REDIRECT_PATH) {
      return null;
    }
    return <Redirect to={{ pathname: '/feed/top' }} />;
  }
}

export default IndexRedirect;
