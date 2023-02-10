import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Credential } from '../schemas/credntial.schema';
export interface Response {
  totalCredentialCount: number;
  data: Array<Credential['credentialId']>;
}
@Injectable()
export class CredentialResponseInterceptor implements NestInterceptor {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<Response> {
    return next.handle().pipe(
      map((data) => {
        const modifiedResponse = {
          totalCredentialCount: data[0]['totalCredentialCount'][0].total,
          data: this.mapData(data[0]['data']),
        };
        return modifiedResponse;
      }),
    );
  }
  mapData(data) {
    return data.map((credential) => credential.credentialId);
  }
}
