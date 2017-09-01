/**
 * Proton UI components
 */

import {
  h,
} from 'preact';

const EMPTY = {};

const component = render => (props = EMPTY) => render(props);

const c = (...args) => [].concat(...args.filter( x => x )).join(' ');

const componentNode = (El, classes: string | string[] = []) => component( ({ children, ...props }) => (
	<El {...props} class={c(props.class, classes)}>{children}</El>
));

export const WindowEl = componentNode('div', ['window']);

export const WindowContent = componentNode('div', ['window-content']);

export const Header = componentNode('header', ['toolbar toolbar-header']);

export const Footer = componentNode('footer', ['toolbar toolbar-footer']);

export const Title = componentNode('h1', 'title');

/** A named icon/glyph from the nice built-in list of icons.
 *	@class
 *	@example
 *	<Icon name="close" />
 */
export const Icon = component( ({ class: className, text, name, children, ...props }) => (
	<span {...props} class={c(className, `icon icon-${name}`, text && 'icon-text')}>{ children }</span>
));

/** Group buttons together.
 *	@example
 *	<ButtonGroup>
 *		<Button>One</Button>
 *		<Button>Two</Button>
 *	</ButtonGroup>
 */
export const ButtonGroup = componentNode('div', 'btn-group');

/** Buttons. They are clickable.
 *	@class
 *	@param {object} props
 *	@param {string} [icon]				If supplied, shows the given named icon to the left of the button text
 *	@param {boolean} [primary=false]	Make the button display as a default action
 *	@example
 *	<Button>Label Text</Button>
 *	@example
 *	<Button icon="home">Home</Button>
 *	@example
 *	<Button large>Large Button</Button>
 *	@example
 *	<Button mini>Small Button</Button>
 *	@example
 *	<Button primary>Preferred Action</Button>
 *	@example
 *	<Button type="positive">Green</Button>
 *	@example
 *	<Button type="negative">Red</Button>
 *	@example
 *	<Button type="warning">Yellow</Button>
 */
export const Button = component( ({
	class: className,
	children,
	icon,
	type,
	primary,
	dropdown,
	mini,
	large,
	form,
	...props
}) => (
	<button {...props} class={c(
		className,
		`btn btn-${type || (primary ? 'primary' : 'default')}`,
		dropdown && 'btn-dropdown',
		large && 'btn-large',
		mini && 'btn-mini',
		form && 'btn-form'
	)}>
		{ icon ? (<Icon name={icon} text={ children && children.length ? true : null } />) : null }
		{ children }
	</button>
));

/** Group of sidebar navigation items
 *	@class
 *	@example
 *	<NavGroup>
 *		<NavGroup.Title>Faves</NavGroup.Title>
 *		<NavGroup.Item>Foo</NavGroup.Item>
 *	</NavGroup>
 */
export const NavGroup = componentNode('nav', 'nav-group');

/** Title for a group of navigation items.
 *	@class
 *	@example
 *	<NavGroup.Title>Faves</NavGroup.Title>
 */
export const NavGroupTitle = componentNode('h5', 'nav-group-title');

/** A single navigation item with optional icon.
 *	@class
 *	@example
 *	<NavGroup.Item>Home</NavGroup.Item>
 *	@example
 *	<NavGroup.Item icon="folder">Documents</NavGroup.Item>
 */
export const NavGroupItem = component( ({ class:className, icon, children, ...props }) => (
	<span {...props} class={c(className, 'nav-group-item')}>
		{ icon ? (<Icon name={icon} />) : null }
		{ children }
	</span>
));


/** Group of list items
 *	@class
 *	@example
 *	<ListGroup>
 *		<ListGroup.Header>
 *			<input class="form-control" type="text" placeholder="Search...">
 *		</ListGroup.Header>
 *		<ListGroup.Item>Foo</ListGroup.Item>
 *	</ListGroup>
 */
export const ListGroup = componentNode('ul', 'list-group');

/** Top header item in a list group.
 *	@class
 *	@example
 *	<ListGroup.Header>
 *		<input class="form-control" type="text" placeholder="Search...">
 *	</ListGroup.Header>
 */
export const ListGroupHeader = componentNode('li', 'list-group-header');

/** A single navigation item with optional icon.
 *	@class
 *	@example
 *	<ListGroup.Item>Home</ListGroup.Item>
 */
export const ListGroupItem = componentNode('li', 'list-group-item');


/** HTML `<form>` */
export const Form = componentNode('form');

/** Basically `<fieldset>` */
export const FormGroup = componentNode('div', 'form-group');

/** Group buttons at the bottom of a form. */
export const FormActions = componentNode('div', 'form-actions');

/** Just an enhanced `<table>` */
export const Table = component( ({ class:className, striped, children, ...props }) => (
	<table {...props} class={c(className, striped && 'table-striped')}>
		{ children }
	</table>
));

/** Pane */
export const Pane = componentNode('div', 'pane');

/** PaneGroup  */
export const PaneGroup = componentNode('div', 'pane-group');

/** Sidebar */
export const Sidebar = componentNode('div', 'sidebar');

/** Progress */
export const Progress = componentNode('progress');
