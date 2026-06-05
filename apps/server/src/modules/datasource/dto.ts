import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateDataSourceDto {
  @IsString()
  @MaxLength(64)
  appCode!: string;

  @IsEnum(['postgres', 'mysql', 'mssql', 'oracle', 'sqlite', 'mariadb', 'tidb'])
  dialect!: 'postgres' | 'mysql' | 'mssql' | 'oracle' | 'sqlite' | 'mariadb' | 'tidb';

  @IsString()
  @MaxLength(100)
  displayName!: string;

  @IsString()
  @MaxLength(253)
  host!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  port!: number;

  @IsString()
  @MinLength(1)
  database!: string;

  @IsOptional()
  @IsString()
  schema?: string;

  @IsString()
  username!: string;

  @IsString()
  password!: string;

  @IsOptional()
  @IsEnum(['disable', 'require', 'verify-ca', 'verify-full'])
  sslMode?: 'disable' | 'require' | 'verify-ca' | 'verify-full';
}

/**
 * 更新数据源：所有字段都可选。
 *  - password 留空 / undefined 表示"不改密码"，沿用原密文。
 *  - host 改了会重做 SSRF 校验。
 *  - appCode / dialect 不允许改（关联 dataset / scan 都依赖它们，改了语义会乱）。
 */
export class UpdateDataSourceDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(253)
  host?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  database?: string;

  @IsOptional()
  @IsString()
  schema?: string;

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @IsEnum(['disable', 'require', 'verify-ca', 'verify-full'])
  sslMode?: 'disable' | 'require' | 'verify-ca' | 'verify-full';
}
