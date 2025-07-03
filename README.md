# explanation-fun
## build

```shell
npm install -g pnpm
pnpm install
pnpm install --registry=https://registry.npmmirror.com

cd /data/apps/explanation-fun
git pull
pnpm build
sudo cp -rf dist/* /opt/1panel/www/sites/jieti.cc/index/
```