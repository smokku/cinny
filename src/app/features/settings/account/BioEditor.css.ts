import { globalStyle, style } from '@vanilla-extract/css';
import { color, config } from 'folds';

export const BioEditorContainer = style({
  backgroundColor: color.SurfaceVariant.Container,
  borderRadius: config.radii.R400,
  overflow: 'hidden',
});

globalStyle(`${BioEditorContainer} div[class*="EditorTextarea"]`, {
  backgroundColor: `${color.SurfaceVariant.Container} !important`,
  border: 'none !important',
});

globalStyle(`${BioEditorContainer} [class*="Toolbar"]`, {
  backgroundColor: `${color.SurfaceVariant.Container} !important`,
  padding: `${config.space.S100} !important`,
  borderTop: `1px solid ${color.SurfaceVariant.ContainerLine} !important`,
});

globalStyle(`${BioEditorContainer} [class*="Toolbar"] button`, {
  backgroundColor: 'transparent !important',
  boxShadow: 'none !important',
});

globalStyle(`${BioEditorContainer} [class*="Toolbar"] button:hover`, {
  backgroundColor: `${color.SurfaceVariant.ContainerHover} !important`,
});
