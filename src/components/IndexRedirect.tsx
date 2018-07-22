/**
 * Index redirect
 */

import { PureComponent } from 'react';

interface IndexRedirectProps {
  navigate: (route: string) => void;
}

class IndexRedirect extends PureComponent<IndexRedirectProps, {}> {
  public componentDidMount() {
    this.props.navigate('/feed/top');
  }

  public render() {
    return null;
  }
}

export default IndexRedirect;
