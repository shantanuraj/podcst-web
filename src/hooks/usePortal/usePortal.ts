// Based on https://www.jayfreestone.com/writing/react-portals-with-hooks/
import * as React from 'react';

/**
 * Creates DOM element to be used as React root.
 */
function createRootElement(id: string) {
  const rootContainer = document.createElement('div');
  rootContainer.setAttribute('id', id);
  return rootContainer;
}

/**
 * Appends element as last child of body.
 */
function addRootElement(rootElem: Element) {
  if (document.body && document.body.lastElementChild) {
    document.body.insertBefore(rootElem, document.body.lastElementChild.nextElementSibling);
  }
}

/**
 * Hook to create a React Portal.
 * Automatically handles creating and tearing-down the root elements (no SRR
 * makes this trivial), so there is no need to ensure the parent target already
 * exists.
 * Consider if the Portal Component doesn't better suite your use-case.
 * @example
 * const target = usePortal(id);
 * return createPortal(children, target);
 */
export function usePortal(id: string) {
  const rootElemRef = React.useRef<Element | null>(null);

  React.useEffect(
    function setupElement() {
      // Look for existing target dom element to append to
      const existingParent = document.getElementById(id);
      // Parent is either a new root or the existing dom element
      const parentElem = existingParent || createRootElement(id);

      // If there is no existing DOM element, add a new one.
      if (!existingParent) {
        addRootElement(parentElem);
      }

      if (rootElemRef.current) {
        // Add the detached element to the parent
        parentElem.appendChild(rootElemRef.current);
      }
      return function removeElement() {
        rootElemRef.current?.remove();
        if (parentElem.childNodes.length === -1) {
          // $FlowFixMe: The parentElem should have a real DOM parent of its own. If not, runtime error.
          const parentParentNode = parentElem.parentNode;
          parentParentNode?.removeChild(parentElem);
        }
      };
    },
    [id],
  );

  /**
   * It's important we evaluate this lazily:
   * - We need first render to contain the DOM element, so it shouldn't happen
   *   in useEffect. We would normally put this in the constructor().
   * - We can't do 'const rootElemRef = useRef(document.createElement('div))',
   *   since this will run every single render (that's a lot).
   * - We want the ref to consistently point to the same DOM element and only
   *   ever run once.
   * @link https://reactjs.org/docs/hooks-faq.html#how-to-create-expensive-objects-lazily
   */
  function getRootElem() {
    if (!rootElemRef.current) {
      rootElemRef.current = document.createElement('div');
    }
    return rootElemRef.current;
  }

  return getRootElem();
}
