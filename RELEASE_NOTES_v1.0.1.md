# VRC 素材整理器 v1.0.1

## 修复

- 修复便携版仍将 LLM 设置、日志与 BOOTH 缩略图写入 Windows AppData 的问题。
- 便携版现在会在 EXE 同级创建 `VRC素材整理器数据`，其中保存 `settings.json`、`cache` 和 `logs`；复制 EXE 时一并复制该文件夹即可迁移应用数据。
- 安装版仍使用 Windows AppData，避免写入安装目录。

素材的分类、链接和附属关系仍保存在各自素材根目录的 `.vrc-asset-organizer.json` 中。

## 下载

- `VRC素材整理器 Setup 1.0.1.exe`：安装版。
- `VRC素材整理器 1.0.1.exe`：真正便携版。

请同时下载 Release 附带的 `SHA256SUMS-v1.0.1.txt`，在 PowerShell 使用 `Get-FileHash` 验证文件完整性。
