package kintsugi

import (
	"context"
	"fmt"
	"net/url"
)

// DatasetClient — generic CRUD/query bag for one dataset.
type DatasetClient struct {
	c           *Client
	datasetCode string
	base        string
}

// Filter — POST <base>/filter. Response is decoded into out (typically *Paged[T]).
func (d *DatasetClient) Filter(ctx context.Context, req FilterRequest, out any) error {
	return d.c.Request(ctx, "POST", d.base+"/filter", req, out)
}

// GetOne — GET <base>/{id}. id is stringified before url.PathEscape.
func (d *DatasetClient) GetOne(ctx context.Context, id any, out any) error {
	return d.c.Request(ctx, "GET", d.idPath(id), nil, out)
}

// Create — POST <base>.
func (d *DatasetClient) Create(ctx context.Context, data any, out any) error {
	return d.c.Request(ctx, "POST", d.base, data, out)
}

// Update — PATCH <base>/{id}.
func (d *DatasetClient) Update(ctx context.Context, id any, data any, out any) error {
	return d.c.Request(ctx, "PATCH", d.idPath(id), data, out)
}

// Delete — DELETE <base>/{id}.
func (d *DatasetClient) Delete(ctx context.Context, id any, out any) error {
	return d.c.Request(ctx, "DELETE", d.idPath(id), nil, out)
}

// BatchCreate — POST <base>/batchCreate { rows: [...] }.
func (d *DatasetClient) BatchCreate(ctx context.Context, rows []any, out any) error {
	return d.c.Request(ctx, "POST", d.base+"/batchCreate", map[string]any{"rows": rows}, out)
}

// Aggregate — POST <base>/aggregate.
func (d *DatasetClient) Aggregate(ctx context.Context, req any, out any) error {
	return d.c.Request(ctx, "POST", d.base+"/aggregate", req, out)
}

// GetSelectOptions — GET <base>/options/{field}.
func (d *DatasetClient) GetSelectOptions(ctx context.Context, field string, out any) error {
	return d.c.Request(ctx, "GET", d.base+"/options/"+url.PathEscape(field), nil, out)
}

func (d *DatasetClient) idPath(id any) string {
	return d.base + "/" + url.PathEscape(fmt.Sprint(id))
}

// ----- request / response shapes (JSON-tagged for direct unmarshal) -----

// FilterRequest mirrors FilterRequest in the platform OpenAPI spec.
type FilterRequest struct {
	Where          []Where   `json:"where,omitempty"`
	OrderBy        []OrderBy `json:"orderBy,omitempty"`
	Page           int       `json:"page,omitempty"`
	PageSize       int       `json:"pageSize,omitempty"`
	Select         []string  `json:"select,omitempty"`
	IncludeDeleted bool      `json:"includeDeleted,omitempty"`
}

// Where condition. Op is one of: eq ne gt gte lt lte like notLike in notIn isNull isNotNull between
type Where struct {
	Field string `json:"field"`
	Op    string `json:"op"`
	Value any    `json:"value,omitempty"`
}

// OrderBy direction is "asc" or "desc".
type OrderBy struct {
	Field     string `json:"field"`
	Direction string `json:"direction,omitempty"`
}

// Paged wraps a typed list response.
type Paged[T any] struct {
	Data     []T `json:"data"`
	Total    int `json:"total"`
	Page     int `json:"page"`
	PageSize int `json:"pageSize"`
}
