import * as React from "react"

function Caret(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" height={24} width={24} {...props}>
      {props.children}
      <path d="M24 24H0V0h24v24z" fill="none" opacity={0.87} />
      <path d="M15.88 9.29L12 13.17 8.12 9.29a.996.996 0 10-1.41 1.41l4.59 4.59c.39.39 1.02.39 1.41 0l4.59-4.59a.996.996 0 000-1.41c-.39-.38-1.03-.39-1.42 0z" />
    </svg>
  )
}

export default Caret
