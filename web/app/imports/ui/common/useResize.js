import { useCallback, useEffect, useState } from 'react'

const useResize = (minHeight) => {

  const [isResizing, setIsResizing] = useState(false);
  const [height, setHeight] = useState(minHeight);

  const enableResize = useCallback(() => {
    setIsResizing(true);
  }, [setIsResizing]);

  const disableResize = useCallback(() => {
    setIsResizing(false);
  }, [setIsResizing]);

  const resize = useCallback(
    (e) => {
      if (isResizing) {
        const newHeight = document.body.offsetHeight - e.clientY // You may want to add some offset here from props
        if (newHeight >= minHeight) {
          setHeight(newHeight);
        }
      }
    },
    [minHeight, isResizing, setHeight],
  );

  useEffect(() => {
    document.addEventListener('mousemove', resize);
    document.addEventListener('mouseup', disableResize);

    return () => {
      document.removeEventListener('mousemove', resize);
      document.removeEventListener('mouseup', disableResize);
    }
  }, [disableResize, resize]);

  return { height, enableResize }
}

export default useResize