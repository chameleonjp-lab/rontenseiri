# 端末内モデルメモ（P0評価用）

実装は `@mlc-ai/web-llm` **0.2.86** の公式 `CreateMLCEngine` と `prebuiltAppConfig` のモデルIDを使用する。公式ドキュメントは https://webllm.mlc.ai/docs/user/basic_usage.html 、Worker実行は https://webllm.mlc.ai/docs/user/advanced_usage.html#using-workers 。WebLLMの公式カタログで確認した配布元は MLC-AI の Hugging Face リポジトリ、対応ランタイムライブラリは `v0_2_86/base` である。

|候補|取得前に提示する情報|配布元|ライセンス|
|---|---|---|---|
|Llama-3.2-1B-Instruct-q4f16_1-MLC|取得量未測定（VRAM目安を取得量と表示しない）|[MLC-AI/Hugging Face](https://huggingface.co/mlc-ai/Llama-3.2-1B-Instruct-q4f16_1-MLC)|Llama 3.2 Community License（原文・再配布条件の確認が必要）|
|Llama-3.2-1B-Instruct-q4f32_1-MLC|取得量未測定（VRAM目安を取得量と表示しない）|[MLC-AI/Hugging Face](https://huggingface.co/mlc-ai/Llama-3.2-1B-Instruct-q4f32_1-MLC)|Llama 3.2 Community License（原文・再配布条件の確認が必要）|

現時点で重み・WASM・キャッシュの**実際の取得量は未測定**であり、取得前に容量既知とは表示しない。固定version metadataから実測サイズを確認できるまで取得を開始しないゲートが必要である。候補は品質・性能・安全ゲート未合格で、初回ダウンロードは `analyzeLocally` 呼び出しまで開始しない。GPU不存在、WebGPU非対応、OOM、モデル取得失敗は成功にせず、UIが手動整理へ戻れる失敗として伝播する。会話本文をモデル提供元へ送る外部API／クラウドfallbackはない。

**未確認:** 日本語構造抽出の品質、G2/G3/G4/G6/G8、実機GPU・Safari・Chrome・Edgeの成立性、初回取得量と時間、モデルライセンスの配布可否の最終レビュー。したがって本実装を本番品質達成とは扱わず、P0評価用の実験的アダプターとする。
