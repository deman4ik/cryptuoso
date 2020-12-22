<a href="https://cryptuoso.com">
 <img align="left" width="150" height="150" src="https://support.cryptuoso.com/cryptuoso_logo.png">  
</a> 
<br>
<a href="https://cryptuoso.com">
<h2 align="center">Cryptuoso - Cryptocurrency Trading Robots</h2>
</a> 
<br>
<br>

## Repository

Code organized using [Nx](https://nx.dev).

## Development

### Services (applications)

#### Creating new service

1. Run `npm run gen:app -- my-app` to generate new service (application).

2. Add `"build:my-app": "nx build my-app --prod"` and `"serve:my-app": "nx serve my-app"` to `package.json` scripts sections

3. Create file `apps/my-app/src/app/service.ts` with class which extends `BaseService` or `HttpService` from `@cryptuoso/service`.

4. Update file `apps/my-app/src/main.ts` whith service starting script:

```ts
import Service from "./app/service";
import log from "@cryptuoso/logger";

const service = new Service();

async function start() {
    try {
        await service.startService();
    } catch (error) {
        log.error(`Failed to start service ${process.env.SERVICE}`, error);
        process.exit(1);
    }
}
start();
```

5. Copy `deployments/deployment-template.yaml` file to `deployments/my-app.yaml`, add environment variables and change ports

### Generate a library

Run `npm run gen:lib -- my-lib` to generate a library.

### Build

Run `nx build my-app` to build the project. The build artifacts will be stored in the `dist/` directory. Use the `--prod` flag for a production build.

### Running unit tests

Run `nx test my-app` to execute the unit tests via [Jest](https://jestjs.io).

Run `nx affected:test` to execute the unit tests affected by a change.

### Understand dependencies

Run `nx dep-graph` to see a diagram of the dependencies.
