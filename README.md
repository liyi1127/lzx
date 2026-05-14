# 教师满意度调查问卷

## 本地启动

```bash
npm start
```

如果你在 Windows 上想双击直接打开，也可以使用：

- `启动问卷.bat`
- `打开后台.bat`

启动后访问：

- 问卷页：`http://localhost:3000/`
- 后台看板：`http://localhost:3000/admin`

## 已支持功能

- 问卷填写与数据收集
- 后台数据看板
- Excel 表格导出
- 二维码分享
- 公网部署后可直接微信分享填写
- 后台管理员账号密码保护

## 数据文件位置

- 默认数据文件：`data/surveys.json`
- 默认导出目录：`data/exports/`

## 公网部署建议

推荐部署到 Render，并启用持久化磁盘，否则服务器重启后问卷数据会丢失。

### Render 部署步骤

1. 把当前项目推到 GitHub 仓库
2. 在 Render 新建 `Blueprint`
3. 选择本仓库，Render 会读取 `render.yaml`
4. 在环境变量里填写：

- `PUBLIC_BASE_URL`
  例：`https://你的项目.onrender.com`
- `ADMIN_USERNAME`
  例：`admin`
- `ADMIN_PASSWORD`
  例：请设置一个强密码

5. 部署完成后：

- 问卷公网地址：`https://你的项目.onrender.com/`
- 后台地址：`https://你的项目.onrender.com/admin`

## 微信分享说明

- 可直接把问卷公网链接发到微信
- 也可打开问卷首页，用页面里的二维码给他人扫码填写
- 微信端填写会直接提交到云端后台
