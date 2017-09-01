/**
 * ShareText Text interface
 */
declare module ShareText {

  export interface Text {
    date: number;
    thread: number;
    address: string;
    message: string;
    sent: boolean;
  }

  export type TextThread = [string, ShareText.Text[]];
}

declare module ShareTextApi {

  export interface Texts {
    texts: ShareText.Text[];
  }

}
