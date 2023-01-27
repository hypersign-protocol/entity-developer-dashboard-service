import { Schemas, SchemaDocument } from '../schemas/schemas.schema';
import { FilterQuery, Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { Injectable } from '@nestjs/common';

@Injectable()
export class SchemaRepository {
  constructor(
    @InjectModel(Schemas.name)
    private readonly schemaModel: Model<SchemaDocument>,
  ) {}

  async findOne(schemaFilterQuery: FilterQuery<Schemas>): Promise<Schemas> {
    return this.schemaModel.findOne(schemaFilterQuery);
  }
  async find(schemaFilterQuery: FilterQuery<Schemas>): Promise<Schemas[]> {
    return await this.schemaModel
      .find({ appId: schemaFilterQuery.appId }, { schemaId: 1, _id: 0 })
      .skip(schemaFilterQuery.paginationOption.skip)
      .limit(schemaFilterQuery.paginationOption.limit);
  }

  async create(schema: Schemas): Promise<Schemas> {
    const newSchema = new this.schemaModel(schema);
    return newSchema.save();
  }

  async findOneAndUpdate(
    schemaFilterQuery: FilterQuery<Schemas>,
    schema: Partial<Schemas>,
  ): Promise<Schemas> {
    return this.schemaModel.findOneAndUpdate(schemaFilterQuery, schema, {
      new: true,
    });
  }
}