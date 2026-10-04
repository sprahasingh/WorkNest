import { createContext, useContext } from "react";

export interface ViewerImage {
  src: string;
  alt: string;
}

export const ImageViewerContext = createContext<{
  openImage: (image: ViewerImage) => void;
} | null>(null);

// Opens a picture in the zoomable viewer instead of a new tab.
export function useImageViewer() {
  const value = useContext(ImageViewerContext);
  if (!value) throw new Error("useImageViewer needs an ImageViewerProvider");
  return value;
}
