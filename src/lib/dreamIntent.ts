const draftSectionPattern = /【画面主角】|【场景氛围】|【光线色彩】|【细节感觉】/;
const draftActionPattern = /去花映生成|确认生成图片|绘梦小稿/;

export function isDreamDraftContent(content = "") {
  return draftSectionPattern.test(content) && draftActionPattern.test(content);
}
