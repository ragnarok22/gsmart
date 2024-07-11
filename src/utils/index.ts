import clipboard from "clipboardy";

export const copyToClipboard = async (text: string): Promise<void> => {
  try {
    await clipboard.write(text);
  } catch (error) {
    console.error("An error occurred while copying the text to the clipboard");
  }
}
